//! Comptabilité en partie double : plan de comptes, écritures débit/crédit,
//! journaux (VE/AC/BQ/OD), grand livre, balance, fournisseurs et charges
//! externes, synchronisation automatique des flux de réservation/paiement,
//! et vue de trésorerie.
//!
//! Conventions : montants en centimes ; une écriture est équilibrée (débit =
//! crédit, garanti aussi par trigger différé en base) ; les écritures issues
//! des flux (booking/payment) portent un couple (source_type, source_id)
//! unique → la synchronisation est idempotente et peut tourner à chaque tick
//! du scheduler. Une écriture ne se supprime pas : elle s'extourne
//! (contre-passation) — seules les saisies manuelles non extournées peuvent
//! être supprimées, par tolérance de saisie.

use crate::{admin::AdminId, error::AppError, AppState};
use axum::{
    extract::{Extension, Path, Query, State},
    http::StatusCode,
    routing::{get, post, put},
    Json, Router,
};
use chrono::{Datelike, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, PgPool, Postgres, Transaction};
use std::collections::HashMap;
use uuid::Uuid;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route(
            "/accounting/accounts",
            get(list_accounts).post(create_account),
        )
        .route(
            "/accounting/accounts/:id",
            put(update_account).delete(delete_account),
        )
        .route("/accounting/entries", get(list_entries).post(create_entry))
        .route(
            "/accounting/entries/:id",
            axum::routing::delete(delete_entry),
        )
        .route("/accounting/entries/:id/reverse", post(reverse_entry))
        .route("/accounting/ledger/:account_id", get(account_ledger))
        .route("/accounting/balance", get(trial_balance))
        .route(
            "/accounting/suppliers",
            get(list_suppliers).post(create_supplier),
        )
        .route(
            "/accounting/suppliers/:id",
            put(update_supplier).delete(delete_supplier),
        )
        .route(
            "/accounting/supplier-invoices",
            get(list_supplier_invoices).post(create_supplier_invoice),
        )
        .route(
            "/accounting/supplier-invoices/:id",
            put(update_supplier_invoice).delete(delete_supplier_invoice),
        )
        .route(
            "/accounting/supplier-invoices/:id/pay",
            post(pay_supplier_invoice),
        )
        .route(
            "/accounting/supplier-invoices/:id/unpay",
            post(unpay_supplier_invoice),
        )
        .route("/accounting/sync", post(sync_now))
        .route("/accounting/cashflow", get(cashflow))
        .route("/accounting/report/meta", get(report_meta))
        .route("/accounting/report/year", get(report_year))
        .route("/accounting/report/season", get(report_season))
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Codes des comptes seedés utilisés par la génération automatique.
const ACC_CLIENTS: &str = "411000";
const ACC_FOURNISSEURS: &str = "401000";
const ACC_TAXE_SEJOUR: &str = "447800";
const ACC_BANQUE: &str = "512100";
const ACC_STRIPE: &str = "517000";
const ACC_LOYERS: &str = "706000";
const ACC_PRESTATIONS: &str = "708300";
const ACC_INDEMNITES: &str = "708800";

async fn account_id_by_code(
    tx: &mut Transaction<'_, Postgres>,
    code: &str,
) -> Result<Uuid, AppError> {
    sqlx::query_scalar::<_, Uuid>("select id from account where code = $1")
        .bind(code)
        .fetch_optional(&mut **tx)
        .await?
        .ok_or_else(|| AppError::Internal(format!("compte {code} absent du plan comptable")))
}

/// Numéro de pièce suivant pour un journal et une année : `VE-2026-0001`.
/// Verrou advisory transactionnel pour éviter les doublons en concurrence.
async fn next_piece(
    tx: &mut Transaction<'_, Postgres>,
    journal: &str,
    year: i32,
) -> Result<String, AppError> {
    sqlx::query("select pg_advisory_xact_lock(hashtext($1))")
        .bind(format!("piece:{journal}:{year}"))
        .execute(&mut **tx)
        .await?;
    let prefix = format!("{journal}-{year}-");
    let max: Option<i32> = sqlx::query_scalar(
        "select max(substring(piece from '[0-9]+$')::int) from ledger_entry \
         where journal = $1 and piece like $2 || '%'",
    )
    .bind(journal)
    .bind(&prefix)
    .fetch_one(&mut **tx)
    .await?;
    Ok(format!("{prefix}{:04}", max.unwrap_or(0) + 1))
}

struct LineSpec {
    account_id: Uuid,
    label: String,
    debit_cents: i64,
    credit_cents: i64,
    supplier_id: Option<Uuid>,
    booking_id: Option<Uuid>,
}

impl LineSpec {
    fn debit(account_id: Uuid, cents: i64) -> Self {
        Self {
            account_id,
            label: String::new(),
            debit_cents: cents,
            credit_cents: 0,
            supplier_id: None,
            booking_id: None,
        }
    }
    fn credit(account_id: Uuid, cents: i64) -> Self {
        Self {
            account_id,
            label: String::new(),
            debit_cents: 0,
            credit_cents: cents,
            supplier_id: None,
            booking_id: None,
        }
    }
    fn with_booking(mut self, id: Uuid) -> Self {
        self.booking_id = Some(id);
        self
    }
    fn with_supplier(mut self, id: Uuid) -> Self {
        self.supplier_id = Some(id);
        self
    }
}

/// Insère une écriture équilibrée et ses lignes. Retourne l'id de l'écriture.
#[allow(clippy::too_many_arguments)]
async fn insert_entry(
    tx: &mut Transaction<'_, Postgres>,
    journal: &str,
    entry_date: NaiveDate,
    label: &str,
    source: Option<(&str, String)>,
    reverses: Option<Uuid>,
    created_by: Option<Uuid>,
    lines: &[LineSpec],
) -> Result<Uuid, AppError> {
    let debit: i64 = lines.iter().map(|l| l.debit_cents).sum();
    let credit: i64 = lines.iter().map(|l| l.credit_cents).sum();
    if lines.len() < 2 || debit != credit || debit <= 0 {
        return Err(AppError::BadRequest(format!(
            "Écriture déséquilibrée : débit {debit} ≠ crédit {credit} (au moins 2 lignes)."
        )));
    }
    let piece = next_piece(tx, journal, entry_date.year()).await?;
    let entry_id: Uuid = sqlx::query_scalar(
        "insert into ledger_entry (journal, entry_date, piece, label, source_type, source_id, reverses, created_by) \
         values ($1,$2,$3,$4,$5,$6,$7,$8) returning id",
    )
    .bind(journal)
    .bind(entry_date)
    .bind(&piece)
    .bind(label)
    .bind(source.as_ref().map(|s| s.0))
    .bind(source.as_ref().map(|s| s.1.clone()))
    .bind(reverses)
    .bind(created_by)
    .fetch_one(&mut **tx)
    .await?;
    for (i, l) in lines.iter().enumerate() {
        sqlx::query(
            "insert into ledger_line \
             (entry_id, account_id, label, debit_cents, credit_cents, supplier_id, booking_id, position) \
             values ($1,$2,$3,$4,$5,$6,$7,$8)",
        )
        .bind(entry_id)
        .bind(l.account_id)
        .bind(&l.label)
        .bind(l.debit_cents)
        .bind(l.credit_cents)
        .bind(l.supplier_id)
        .bind(l.booking_id)
        .bind(i as i32)
        .execute(&mut **tx)
        .await?;
    }
    if let Some(rev) = reverses {
        sqlx::query("update ledger_entry set reversed_by = $1 where id = $2")
            .bind(entry_id)
            .bind(rev)
            .execute(&mut **tx)
            .await?;
    }
    Ok(entry_id)
}

// ---------------------------------------------------------------------------
// Plan de comptes
// ---------------------------------------------------------------------------

#[derive(Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
struct AccountDto {
    id: Uuid,
    code: String,
    name: String,
    is_system: bool,
    is_active: bool,
    debit_cents: i64,
    credit_cents: i64,
    balance_cents: i64,
}

async fn list_accounts(State(st): State<AppState>) -> Result<Json<Vec<AccountDto>>, AppError> {
    let rows = sqlx::query_as::<_, AccountDto>(
        "select a.id, a.code, a.name, a.is_system, a.is_active, \
                coalesce(sum(l.debit_cents),0)::bigint as debit_cents, \
                coalesce(sum(l.credit_cents),0)::bigint as credit_cents, \
                (coalesce(sum(l.debit_cents),0) - coalesce(sum(l.credit_cents),0))::bigint as balance_cents \
         from account a \
         left join ledger_line l on l.account_id = a.id \
         group by a.id order by a.code",
    )
    .fetch_all(&st.pool)
    .await?;
    Ok(Json(rows))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AccountInput {
    code: String,
    name: String,
}

async fn create_account(
    State(st): State<AppState>,
    Json(body): Json<AccountInput>,
) -> Result<Json<serde_json::Value>, AppError> {
    let code = body.code.trim();
    let name = body.name.trim();
    if !code.chars().all(|c| c.is_ascii_digit())
        || !(3..=8).contains(&code.len())
        || !('1'..='8').contains(&code.chars().next().unwrap_or('0'))
    {
        return Err(AppError::BadRequest(
            "Code invalide : 3 à 8 chiffres, classes 1 à 8 (ex. 606100).".into(),
        ));
    }
    if name.is_empty() {
        return Err(AppError::BadRequest("Le libellé est requis.".into()));
    }
    let id: Uuid = sqlx::query_scalar(
        "insert into account (code, name) values ($1, $2) \
         on conflict (code) do nothing returning id",
    )
    .bind(code)
    .bind(name)
    .fetch_optional(&st.pool)
    .await?
    .ok_or_else(|| AppError::BadRequest(format!("Le compte {code} existe déjà.")))?;
    Ok(Json(serde_json::json!({ "id": id })))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AccountUpdate {
    name: Option<String>,
    is_active: Option<bool>,
}

async fn update_account(
    State(st): State<AppState>,
    Path(id): Path<Uuid>,
    Json(body): Json<AccountUpdate>,
) -> Result<StatusCode, AppError> {
    let is_system: bool = sqlx::query_scalar("select is_system from account where id = $1")
        .bind(id)
        .fetch_optional(&st.pool)
        .await?
        .ok_or_else(|| AppError::NotFound("compte".into()))?;
    if body.is_active.is_some() && is_system {
        return Err(AppError::BadRequest(
            "Un compte système ne peut pas être désactivé.".into(),
        ));
    }
    sqlx::query(
        "update account set name = coalesce($2, name), is_active = coalesce($3, is_active) \
         where id = $1",
    )
    .bind(id)
    .bind(body.name.as_deref().map(str::trim))
    .bind(body.is_active)
    .execute(&st.pool)
    .await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn delete_account(
    State(st): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, AppError> {
    let (is_system, used): (bool, bool) = sqlx::query_as(
        "select is_system, exists(select 1 from ledger_line where account_id = $1) \
         from account where id = $1",
    )
    .bind(id)
    .fetch_optional(&st.pool)
    .await?
    .ok_or_else(|| AppError::NotFound("compte".into()))?;
    if is_system {
        return Err(AppError::BadRequest(
            "Un compte système ne peut pas être supprimé.".into(),
        ));
    }
    if used {
        return Err(AppError::BadRequest(
            "Ce compte porte des écritures — désactivez-le plutôt.".into(),
        ));
    }
    sqlx::query("delete from account where id = $1")
        .bind(id)
        .execute(&st.pool)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

// ---------------------------------------------------------------------------
// Écritures : liste, saisie manuelle (OD), extourne, suppression
// ---------------------------------------------------------------------------

#[derive(Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
struct EntryLineDto {
    id: Uuid,
    account_id: Uuid,
    account_code: String,
    account_name: String,
    label: String,
    debit_cents: i64,
    credit_cents: i64,
    supplier_name: Option<String>,
    booking_reference: Option<String>,
}

#[derive(Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
struct EntryHead {
    id: Uuid,
    journal: String,
    entry_date: NaiveDate,
    piece: String,
    label: String,
    source_type: Option<String>,
    reverses: Option<Uuid>,
    reversed_by: Option<Uuid>,
    created_at: chrono::DateTime<Utc>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct EntryDto {
    #[serde(flatten)]
    head: EntryHead,
    lines: Vec<EntryLineDto>,
}

#[derive(Deserialize)]
struct EntriesQuery {
    journal: Option<String>,
    from: Option<NaiveDate>,
    to: Option<NaiveDate>,
    #[serde(rename = "accountId")]
    account_id: Option<Uuid>,
    limit: Option<i64>,
}

async fn list_entries(
    State(st): State<AppState>,
    Query(q): Query<EntriesQuery>,
) -> Result<Json<Vec<EntryDto>>, AppError> {
    let limit = q.limit.unwrap_or(200).clamp(1, 1000);
    let heads = sqlx::query_as::<_, EntryHead>(
        "select distinct e.id, e.journal, e.entry_date, e.piece, e.label, e.source_type, \
                e.reverses, e.reversed_by, e.created_at \
         from ledger_entry e \
         left join ledger_line l on l.entry_id = e.id \
         where ($1::text is null or e.journal = $1) \
           and ($2::date is null or e.entry_date >= $2) \
           and ($3::date is null or e.entry_date <= $3) \
           and ($4::uuid is null or l.account_id = $4) \
         order by e.entry_date desc, e.piece desc \
         limit $5",
    )
    .bind(q.journal.as_deref().filter(|j| !j.is_empty()))
    .bind(q.from)
    .bind(q.to)
    .bind(q.account_id)
    .bind(limit)
    .fetch_all(&st.pool)
    .await?;

    let ids: Vec<Uuid> = heads.iter().map(|h| h.id).collect();
    #[derive(FromRow)]
    struct LineWithEntry {
        entry_id: Uuid,
        #[sqlx(flatten)]
        line: EntryLineDto,
    }
    let lines = sqlx::query_as::<_, LineWithEntry>(
        "select l.entry_id, l.id, l.account_id, a.code as account_code, a.name as account_name, \
                l.label, l.debit_cents, l.credit_cents, s.name as supplier_name, b.reference as booking_reference \
         from ledger_line l \
         join account a on a.id = l.account_id \
         left join supplier s on s.id = l.supplier_id \
         left join booking b on b.id = l.booking_id \
         where l.entry_id = any($1) order by l.position",
    )
    .bind(&ids)
    .fetch_all(&st.pool)
    .await?;

    let mut by_entry: HashMap<Uuid, Vec<EntryLineDto>> = HashMap::new();
    for l in lines {
        by_entry.entry(l.entry_id).or_default().push(l.line);
    }
    Ok(Json(
        heads
            .into_iter()
            .map(|h| EntryDto {
                lines: by_entry.remove(&h.id).unwrap_or_default(),
                head: h,
            })
            .collect(),
    ))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct NewEntryLine {
    account_id: Uuid,
    #[serde(default)]
    label: String,
    #[serde(default)]
    debit_cents: i64,
    #[serde(default)]
    credit_cents: i64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct NewEntry {
    journal: String,
    entry_date: NaiveDate,
    label: String,
    lines: Vec<NewEntryLine>,
}

async fn create_entry(
    State(st): State<AppState>,
    Extension(admin): Extension<AdminId>,
    Json(body): Json<NewEntry>,
) -> Result<Json<serde_json::Value>, AppError> {
    if !["VE", "AC", "BQ", "OD"].contains(&body.journal.as_str()) {
        return Err(AppError::BadRequest("Journal invalide.".into()));
    }
    if body.label.trim().is_empty() {
        return Err(AppError::BadRequest("Le libellé est requis.".into()));
    }
    for l in &body.lines {
        if l.debit_cents < 0 || l.credit_cents < 0 {
            return Err(AppError::BadRequest("Montants négatifs interdits.".into()));
        }
        if (l.debit_cents == 0) == (l.credit_cents == 0) {
            return Err(AppError::BadRequest(
                "Chaque ligne doit être soit au débit, soit au crédit.".into(),
            ));
        }
    }
    let lines: Vec<LineSpec> = body
        .lines
        .iter()
        .map(|l| LineSpec {
            account_id: l.account_id,
            label: l.label.trim().to_string(),
            debit_cents: l.debit_cents,
            credit_cents: l.credit_cents,
            supplier_id: None,
            booking_id: None,
        })
        .collect();
    let mut tx = st.pool.begin().await?;
    let id = insert_entry(
        &mut tx,
        &body.journal,
        body.entry_date,
        body.label.trim(),
        None,
        None,
        Some(admin.0),
        &lines,
    )
    .await?;
    tx.commit().await?;
    Ok(Json(serde_json::json!({ "id": id })))
}

/// Contre-passation : écriture inverse (débits ↔ crédits) datée du jour.
async fn reverse_entry(
    State(st): State<AppState>,
    Extension(admin): Extension<AdminId>,
    Path(id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, AppError> {
    let mut tx = st.pool.begin().await?;
    let head = sqlx::query_as::<_, (String, String, Option<Uuid>)>(
        "select journal, piece, reversed_by from ledger_entry where id = $1 for update",
    )
    .bind(id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::NotFound("écriture".into()))?;
    if head.2.is_some() {
        return Err(AppError::BadRequest("Écriture déjà extournée.".into()));
    }
    let lines = sqlx::query_as::<_, (Uuid, String, i64, i64, Option<Uuid>, Option<Uuid>)>(
        "select account_id, label, debit_cents, credit_cents, supplier_id, booking_id \
         from ledger_line where entry_id = $1 order by position",
    )
    .bind(id)
    .fetch_all(&mut *tx)
    .await?;
    let specs: Vec<LineSpec> = lines
        .into_iter()
        .map(|(acc, label, d, c, sup, boo)| LineSpec {
            account_id: acc,
            label,
            debit_cents: c,
            credit_cents: d,
            supplier_id: sup,
            booking_id: boo,
        })
        .collect();
    let today = crate::paris_today();
    let rid = insert_entry(
        &mut tx,
        &head.0,
        today,
        &format!("Extourne de {}", head.1),
        None,
        Some(id),
        Some(admin.0),
        &specs,
    )
    .await?;
    tx.commit().await?;
    Ok(Json(serde_json::json!({ "id": rid })))
}

/// Suppression : uniquement une saisie manuelle (sans source) non extournée et
/// qui n'extourne rien — pour corriger une erreur de saisie immédiate.
async fn delete_entry(
    State(st): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, AppError> {
    let row = sqlx::query_as::<_, (Option<String>, Option<Uuid>, Option<Uuid>)>(
        "select source_type, reverses, reversed_by from ledger_entry where id = $1",
    )
    .bind(id)
    .fetch_optional(&st.pool)
    .await?
    .ok_or_else(|| AppError::NotFound("écriture".into()))?;
    if row.0.is_some() {
        return Err(AppError::BadRequest(
            "Écriture générée automatiquement : extournez-la plutôt.".into(),
        ));
    }
    if row.1.is_some() || row.2.is_some() {
        return Err(AppError::BadRequest(
            "Écriture liée à une extourne : non supprimable.".into(),
        ));
    }
    sqlx::query("delete from ledger_entry where id = $1")
        .bind(id)
        .execute(&st.pool)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

// ---------------------------------------------------------------------------
// Grand livre & balance
// ---------------------------------------------------------------------------

#[derive(Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
struct LedgerRow {
    entry_id: Uuid,
    entry_date: NaiveDate,
    journal: String,
    piece: String,
    entry_label: String,
    line_label: String,
    debit_cents: i64,
    credit_cents: i64,
    #[sqlx(default)]
    running_cents: i64,
}

#[derive(Deserialize)]
struct PeriodQuery {
    from: Option<NaiveDate>,
    to: Option<NaiveDate>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LedgerResponse {
    account_code: String,
    account_name: String,
    opening_cents: i64,
    rows: Vec<LedgerRow>,
    total_debit_cents: i64,
    total_credit_cents: i64,
    closing_cents: i64,
}

async fn account_ledger(
    State(st): State<AppState>,
    Path(account_id): Path<Uuid>,
    Query(q): Query<PeriodQuery>,
) -> Result<Json<LedgerResponse>, AppError> {
    let (code, name): (String, String) =
        sqlx::query_as("select code, name from account where id = $1")
            .bind(account_id)
            .fetch_optional(&st.pool)
            .await?
            .ok_or_else(|| AppError::NotFound("compte".into()))?;
    // Report à nouveau : solde des écritures antérieures à la période.
    let opening: i64 = match q.from {
        Some(from) => {
            sqlx::query_scalar(
                "select coalesce(sum(l.debit_cents - l.credit_cents),0)::bigint \
             from ledger_line l join ledger_entry e on e.id = l.entry_id \
             where l.account_id = $1 and e.entry_date < $2",
            )
            .bind(account_id)
            .bind(from)
            .fetch_one(&st.pool)
            .await?
        }
        None => 0,
    };
    let mut rows = sqlx::query_as::<_, LedgerRow>(
        "select e.id as entry_id, e.entry_date, e.journal, e.piece, e.label as entry_label, \
                l.label as line_label, l.debit_cents, l.credit_cents \
         from ledger_line l join ledger_entry e on e.id = l.entry_id \
         where l.account_id = $1 \
           and ($2::date is null or e.entry_date >= $2) \
           and ($3::date is null or e.entry_date <= $3) \
         order by e.entry_date, e.piece, l.position",
    )
    .bind(account_id)
    .bind(q.from)
    .bind(q.to)
    .fetch_all(&st.pool)
    .await?;
    let mut running = opening;
    let (mut td, mut tc) = (0i64, 0i64);
    for r in &mut rows {
        running += r.debit_cents - r.credit_cents;
        r.running_cents = running;
        td += r.debit_cents;
        tc += r.credit_cents;
    }
    Ok(Json(LedgerResponse {
        account_code: code,
        account_name: name,
        opening_cents: opening,
        rows,
        total_debit_cents: td,
        total_credit_cents: tc,
        closing_cents: running,
    }))
}

#[derive(Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
struct BalanceRow {
    account_id: Uuid,
    code: String,
    name: String,
    debit_cents: i64,
    credit_cents: i64,
    balance_cents: i64,
}

async fn trial_balance(
    State(st): State<AppState>,
    Query(q): Query<PeriodQuery>,
) -> Result<Json<Vec<BalanceRow>>, AppError> {
    let rows = sqlx::query_as::<_, BalanceRow>(
        "select a.id as account_id, a.code, a.name, \
                coalesce(sum(l.debit_cents),0)::bigint as debit_cents, \
                coalesce(sum(l.credit_cents),0)::bigint as credit_cents, \
                (coalesce(sum(l.debit_cents),0) - coalesce(sum(l.credit_cents),0))::bigint as balance_cents \
         from account a \
         join ledger_line l on l.account_id = a.id \
         join ledger_entry e on e.id = l.entry_id \
         where ($1::date is null or e.entry_date >= $1) \
           and ($2::date is null or e.entry_date <= $2) \
         group by a.id, a.code, a.name \
         having coalesce(sum(l.debit_cents),0) <> 0 or coalesce(sum(l.credit_cents),0) <> 0 \
         order by a.code",
    )
    .bind(q.from)
    .bind(q.to)
    .fetch_all(&st.pool)
    .await?;
    Ok(Json(rows))
}

// ---------------------------------------------------------------------------
// Fournisseurs
// ---------------------------------------------------------------------------

#[derive(Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
struct SupplierDto {
    id: Uuid,
    name: String,
    email: String,
    phone: String,
    address: String,
    iban: String,
    notes: String,
    default_account_id: Option<Uuid>,
    is_active: bool,
    invoice_count: i64,
    total_cents: i64,
    unpaid_cents: i64,
}

async fn list_suppliers(State(st): State<AppState>) -> Result<Json<Vec<SupplierDto>>, AppError> {
    let rows = sqlx::query_as::<_, SupplierDto>(
        "select s.id, s.name, s.email, s.phone, s.address, s.iban, s.notes, \
                s.default_account_id, s.is_active, \
                count(i.id) as invoice_count, \
                coalesce(sum(i.amount_cents),0)::bigint as total_cents, \
                coalesce(sum(i.amount_cents) filter (where i.status = 'a_payer'),0)::bigint as unpaid_cents \
         from supplier s \
         left join supplier_invoice i on i.supplier_id = s.id \
         group by s.id order by s.name",
    )
    .fetch_all(&st.pool)
    .await?;
    Ok(Json(rows))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SupplierInput {
    name: String,
    #[serde(default)]
    email: String,
    #[serde(default)]
    phone: String,
    #[serde(default)]
    address: String,
    #[serde(default)]
    iban: String,
    #[serde(default)]
    notes: String,
    default_account_id: Option<Uuid>,
    #[serde(default = "default_true")]
    is_active: bool,
}

fn default_true() -> bool {
    true
}

async fn create_supplier(
    State(st): State<AppState>,
    Json(body): Json<SupplierInput>,
) -> Result<Json<serde_json::Value>, AppError> {
    if body.name.trim().is_empty() {
        return Err(AppError::BadRequest("Le nom est requis.".into()));
    }
    let id: Uuid = sqlx::query_scalar(
        "insert into supplier (name, email, phone, address, iban, notes, default_account_id, is_active) \
         values ($1,$2,$3,$4,$5,$6,$7,$8) returning id",
    )
    .bind(body.name.trim())
    .bind(body.email.trim())
    .bind(body.phone.trim())
    .bind(body.address.trim())
    .bind(body.iban.trim())
    .bind(body.notes.trim())
    .bind(body.default_account_id)
    .bind(body.is_active)
    .fetch_one(&st.pool)
    .await?;
    Ok(Json(serde_json::json!({ "id": id })))
}

async fn update_supplier(
    State(st): State<AppState>,
    Path(id): Path<Uuid>,
    Json(body): Json<SupplierInput>,
) -> Result<StatusCode, AppError> {
    if body.name.trim().is_empty() {
        return Err(AppError::BadRequest("Le nom est requis.".into()));
    }
    let n = sqlx::query(
        "update supplier set name=$2, email=$3, phone=$4, address=$5, iban=$6, notes=$7, \
                default_account_id=$8, is_active=$9, updated_at=now() where id=$1",
    )
    .bind(id)
    .bind(body.name.trim())
    .bind(body.email.trim())
    .bind(body.phone.trim())
    .bind(body.address.trim())
    .bind(body.iban.trim())
    .bind(body.notes.trim())
    .bind(body.default_account_id)
    .bind(body.is_active)
    .execute(&st.pool)
    .await?
    .rows_affected();
    if n == 0 {
        return Err(AppError::NotFound("fournisseur".into()));
    }
    Ok(StatusCode::NO_CONTENT)
}

async fn delete_supplier(
    State(st): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, AppError> {
    let used: bool = sqlx::query_scalar(
        "select exists(select 1 from supplier_invoice where supplier_id = $1) \
             or exists(select 1 from ledger_line where supplier_id = $1)",
    )
    .bind(id)
    .fetch_one(&st.pool)
    .await?;
    if used {
        return Err(AppError::BadRequest(
            "Ce fournisseur a des factures ou des écritures — désactivez-le plutôt.".into(),
        ));
    }
    let n = sqlx::query("delete from supplier where id = $1")
        .bind(id)
        .execute(&st.pool)
        .await?
        .rows_affected();
    if n == 0 {
        return Err(AppError::NotFound("fournisseur".into()));
    }
    Ok(StatusCode::NO_CONTENT)
}

// ---------------------------------------------------------------------------
// Factures fournisseurs (charges externes)
// ---------------------------------------------------------------------------

#[derive(Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
struct SupplierInvoiceDto {
    id: Uuid,
    supplier_id: Uuid,
    supplier_name: String,
    label: String,
    invoice_number: String,
    invoice_date: NaiveDate,
    due_date: Option<NaiveDate>,
    amount_cents: i64,
    expense_account_id: Uuid,
    expense_account_code: String,
    expense_account_name: String,
    status: String,
    paid_date: Option<NaiveDate>,
    payment_account_id: Option<Uuid>,
    notes: String,
}

async fn list_supplier_invoices(
    State(st): State<AppState>,
) -> Result<Json<Vec<SupplierInvoiceDto>>, AppError> {
    let rows = sqlx::query_as::<_, SupplierInvoiceDto>(
        "select i.id, i.supplier_id, s.name as supplier_name, i.label, i.invoice_number, \
                i.invoice_date, i.due_date, i.amount_cents, i.expense_account_id, \
                a.code as expense_account_code, a.name as expense_account_name, \
                i.status, i.paid_date, i.payment_account_id, i.notes \
         from supplier_invoice i \
         join supplier s on s.id = i.supplier_id \
         join account a on a.id = i.expense_account_id \
         order by i.invoice_date desc, i.created_at desc",
    )
    .fetch_all(&st.pool)
    .await?;
    Ok(Json(rows))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SupplierInvoiceInput {
    supplier_id: Uuid,
    label: String,
    #[serde(default)]
    invoice_number: String,
    invoice_date: NaiveDate,
    due_date: Option<NaiveDate>,
    amount_cents: i64,
    expense_account_id: Uuid,
    #[serde(default)]
    notes: String,
}

async fn create_supplier_invoice(
    State(st): State<AppState>,
    Extension(admin): Extension<AdminId>,
    Json(body): Json<SupplierInvoiceInput>,
) -> Result<Json<serde_json::Value>, AppError> {
    if body.label.trim().is_empty() {
        return Err(AppError::BadRequest("Le libellé est requis.".into()));
    }
    if body.amount_cents <= 0 {
        return Err(AppError::BadRequest("Montant invalide.".into()));
    }
    let mut tx = st.pool.begin().await?;
    let supplier_name: String = sqlx::query_scalar("select name from supplier where id = $1")
        .bind(body.supplier_id)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(|| AppError::NotFound("fournisseur".into()))?;
    let fournisseurs = account_id_by_code(&mut tx, ACC_FOURNISSEURS).await?;
    let invoice_id = Uuid::new_v4();
    // Écriture d'achat : débit charge, crédit 401 Fournisseurs.
    let entry_id = insert_entry(
        &mut tx,
        "AC",
        body.invoice_date,
        &format!("Facture {} — {}", supplier_name, body.label.trim()),
        Some(("supplier_invoice", invoice_id.to_string())),
        None,
        Some(admin.0),
        &[
            LineSpec::debit(body.expense_account_id, body.amount_cents)
                .with_supplier(body.supplier_id),
            LineSpec::credit(fournisseurs, body.amount_cents).with_supplier(body.supplier_id),
        ],
    )
    .await?;
    sqlx::query(
        "insert into supplier_invoice \
         (id, supplier_id, label, invoice_number, invoice_date, due_date, amount_cents, \
          expense_account_id, notes, entry_id) \
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
    )
    .bind(invoice_id)
    .bind(body.supplier_id)
    .bind(body.label.trim())
    .bind(body.invoice_number.trim())
    .bind(body.invoice_date)
    .bind(body.due_date)
    .bind(body.amount_cents)
    .bind(body.expense_account_id)
    .bind(body.notes.trim())
    .bind(entry_id)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(Json(serde_json::json!({ "id": invoice_id })))
}

/// Modification d'une facture non payée : l'écriture d'achat est régénérée
/// (lignes remplacées, date/libellé mis à jour) pour rester le miroir exact.
async fn update_supplier_invoice(
    State(st): State<AppState>,
    Path(id): Path<Uuid>,
    Json(body): Json<SupplierInvoiceInput>,
) -> Result<StatusCode, AppError> {
    if body.label.trim().is_empty() {
        return Err(AppError::BadRequest("Le libellé est requis.".into()));
    }
    if body.amount_cents <= 0 {
        return Err(AppError::BadRequest("Montant invalide.".into()));
    }
    let mut tx = st.pool.begin().await?;
    let row = sqlx::query_as::<_, (String, Option<Uuid>)>(
        "select status, entry_id from supplier_invoice where id = $1 for update",
    )
    .bind(id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::NotFound("facture".into()))?;
    if row.0 == "payee" {
        return Err(AppError::BadRequest(
            "Facture payée : annulez d'abord le règlement.".into(),
        ));
    }
    let supplier_name: String = sqlx::query_scalar("select name from supplier where id = $1")
        .bind(body.supplier_id)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(|| AppError::NotFound("fournisseur".into()))?;
    sqlx::query(
        "update supplier_invoice set supplier_id=$2, label=$3, invoice_number=$4, \
                invoice_date=$5, due_date=$6, amount_cents=$7, expense_account_id=$8, \
                notes=$9, updated_at=now() where id=$1",
    )
    .bind(id)
    .bind(body.supplier_id)
    .bind(body.label.trim())
    .bind(body.invoice_number.trim())
    .bind(body.invoice_date)
    .bind(body.due_date)
    .bind(body.amount_cents)
    .bind(body.expense_account_id)
    .bind(body.notes.trim())
    .execute(&mut *tx)
    .await?;
    if let Some(entry_id) = row.1 {
        let fournisseurs = account_id_by_code(&mut tx, ACC_FOURNISSEURS).await?;
        sqlx::query("delete from ledger_line where entry_id = $1")
            .bind(entry_id)
            .execute(&mut *tx)
            .await?;
        sqlx::query("update ledger_entry set entry_date = $2, label = $3 where id = $1")
            .bind(entry_id)
            .bind(body.invoice_date)
            .bind(format!("Facture {} — {}", supplier_name, body.label.trim()))
            .execute(&mut *tx)
            .await?;
        for (i, l) in [
            LineSpec::debit(body.expense_account_id, body.amount_cents)
                .with_supplier(body.supplier_id),
            LineSpec::credit(fournisseurs, body.amount_cents).with_supplier(body.supplier_id),
        ]
        .iter()
        .enumerate()
        {
            sqlx::query(
                "insert into ledger_line \
                 (entry_id, account_id, label, debit_cents, credit_cents, supplier_id, position) \
                 values ($1,$2,$3,$4,$5,$6,$7)",
            )
            .bind(entry_id)
            .bind(l.account_id)
            .bind(&l.label)
            .bind(l.debit_cents)
            .bind(l.credit_cents)
            .bind(l.supplier_id)
            .bind(i as i32)
            .execute(&mut *tx)
            .await?;
        }
    }
    tx.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PayInvoiceInput {
    paid_date: NaiveDate,
    payment_account_id: Uuid,
}

async fn pay_supplier_invoice(
    State(st): State<AppState>,
    Extension(admin): Extension<AdminId>,
    Path(id): Path<Uuid>,
    Json(body): Json<PayInvoiceInput>,
) -> Result<StatusCode, AppError> {
    let mut tx = st.pool.begin().await?;
    let row = sqlx::query_as::<_, (String, i64, Uuid, String, String)>(
        "select i.status, i.amount_cents, i.supplier_id, i.label, s.name \
         from supplier_invoice i join supplier s on s.id = i.supplier_id \
         where i.id = $1 for update of i",
    )
    .bind(id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::NotFound("facture".into()))?;
    if row.0 == "payee" {
        return Err(AppError::BadRequest("Facture déjà payée.".into()));
    }
    // Le compte de règlement doit être un compte de trésorerie (classe 5).
    let pay_code: String = sqlx::query_scalar("select code from account where id = $1")
        .bind(body.payment_account_id)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(|| AppError::NotFound("compte de règlement".into()))?;
    if !pay_code.starts_with('5') {
        return Err(AppError::BadRequest(
            "Le règlement doit passer par un compte de trésorerie (classe 5).".into(),
        ));
    }
    let fournisseurs = account_id_by_code(&mut tx, ACC_FOURNISSEURS).await?;
    let entry_id = insert_entry(
        &mut tx,
        "BQ",
        body.paid_date,
        &format!("Règlement {} — {}", row.4, row.3),
        Some(("supplier_payment", id.to_string())),
        None,
        Some(admin.0),
        &[
            LineSpec::debit(fournisseurs, row.1).with_supplier(row.2),
            LineSpec::credit(body.payment_account_id, row.1).with_supplier(row.2),
        ],
    )
    .await?;
    sqlx::query(
        "update supplier_invoice set status='payee', paid_date=$2, payment_account_id=$3, \
                payment_entry_id=$4, updated_at=now() where id=$1",
    )
    .bind(id)
    .bind(body.paid_date)
    .bind(body.payment_account_id)
    .bind(entry_id)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}

/// Annule le règlement (pointage erroné) : supprime l'écriture de banque et
/// repasse la facture « à payer ».
async fn unpay_supplier_invoice(
    State(st): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, AppError> {
    let mut tx = st.pool.begin().await?;
    let row = sqlx::query_as::<_, (String, Option<Uuid>)>(
        "select status, payment_entry_id from supplier_invoice where id = $1 for update",
    )
    .bind(id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::NotFound("facture".into()))?;
    if row.0 != "payee" {
        return Err(AppError::BadRequest("Facture non payée.".into()));
    }
    sqlx::query(
        "update supplier_invoice set status='a_payer', paid_date=null, \
                payment_account_id=null, payment_entry_id=null, updated_at=now() where id=$1",
    )
    .bind(id)
    .execute(&mut *tx)
    .await?;
    if let Some(entry_id) = row.1 {
        sqlx::query("delete from ledger_entry where id = $1")
            .bind(entry_id)
            .execute(&mut *tx)
            .await?;
    }
    tx.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}

/// Suppression d'une facture non payée : la facture et son écriture d'achat
/// disparaissent ensemble (une facture payée doit d'abord être « dé-payée »).
async fn delete_supplier_invoice(
    State(st): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, AppError> {
    let mut tx = st.pool.begin().await?;
    let row = sqlx::query_as::<_, (String, Option<Uuid>)>(
        "select status, entry_id from supplier_invoice where id = $1 for update",
    )
    .bind(id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::NotFound("facture".into()))?;
    if row.0 == "payee" {
        return Err(AppError::BadRequest(
            "Facture payée : annulez d'abord le règlement.".into(),
        ));
    }
    sqlx::query("delete from supplier_invoice where id = $1")
        .bind(id)
        .execute(&mut *tx)
        .await?;
    if let Some(entry_id) = row.1 {
        sqlx::query("delete from ledger_entry where id = $1")
            .bind(entry_id)
            .execute(&mut *tx)
            .await?;
    }
    tx.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}

// ---------------------------------------------------------------------------
// Synchronisation des flux (bookings / payments) → écritures
// ---------------------------------------------------------------------------

/// Génère les écritures manquantes depuis les réservations et paiements.
/// Idempotent (source_type/source_id uniques) — appelé par le scheduler à
/// chaque tick et exposé en bouton « Synchroniser » dans l'admin.
pub async fn sync_ledger(pool: &PgPool) -> Result<i64, AppError> {
    let mut created = 0i64;

    // 1) Factures de séjour : réservation ayant encaissé un acompte (le contrat
    //    est engagé), y compris celles annulées ensuite (l'avoir compense).
    #[derive(FromRow)]
    struct BookingRow {
        id: Uuid,
        reference: String,
        customer_name: Option<String>,
        week_price_cents: i64,
        extras_total_cents: i64,
        tourist_tax_cents: i64,
        deposit_paid_at: chrono::DateTime<Utc>,
    }
    let bookings = sqlx::query_as::<_, BookingRow>(
        "select b.id, b.reference, \
                nullif(trim(coalesce(c.first_name,'') || ' ' || coalesce(c.last_name,'')), '') as customer_name, \
                b.week_price_cents, b.extras_total_cents, b.tourist_tax_cents, b.deposit_paid_at \
         from booking b \
         left join customer c on c.id = b.customer_id \
         where b.deposit_paid_at is not null \
           and not exists (select 1 from ledger_entry e \
                           where e.source_type = 'booking_invoice' and e.source_id = b.id::text) \
         order by b.deposit_paid_at",
    )
    .fetch_all(pool)
    .await?;
    for b in bookings {
        let mut tx = pool.begin().await?;
        let clients = account_id_by_code(&mut tx, ACC_CLIENTS).await?;
        let loyers = account_id_by_code(&mut tx, ACC_LOYERS).await?;
        let prestations = account_id_by_code(&mut tx, ACC_PRESTATIONS).await?;
        let taxe = account_id_by_code(&mut tx, ACC_TAXE_SEJOUR).await?;
        let total = b.week_price_cents + b.extras_total_cents + b.tourist_tax_cents;
        if total <= 0 {
            tx.commit().await?;
            continue;
        }
        let who = b.customer_name.as_deref().unwrap_or("client");
        let mut lines = vec![LineSpec::debit(clients, total).with_booking(b.id)];
        if b.week_price_cents > 0 {
            lines.push(LineSpec::credit(loyers, b.week_price_cents).with_booking(b.id));
        }
        if b.extras_total_cents > 0 {
            lines.push(LineSpec::credit(prestations, b.extras_total_cents).with_booking(b.id));
        }
        if b.tourist_tax_cents > 0 {
            lines.push(LineSpec::credit(taxe, b.tourist_tax_cents).with_booking(b.id));
        }
        insert_entry(
            &mut tx,
            "VE",
            crate::paris_date(b.deposit_paid_at),
            &format!("Séjour {} — {}", b.reference, who),
            Some(("booking_invoice", b.id.to_string())),
            None,
            None,
            &lines,
        )
        .await?;
        tx.commit().await?;
        created += 1;
    }

    // 2) Mouvements de trésorerie : chaque ligne payment aboutie.
    //    Encaissement carte → 517 Stripe ; chèque/virement (manuel) → 512 Banque.
    #[derive(FromRow)]
    struct PaymentRow {
        id: Uuid,
        booking_id: Uuid,
        r#type: String,
        amount_cents: i64,
        method: Option<String>,
        created_at: chrono::DateTime<Utc>,
        reference: String,
    }
    let payments = sqlx::query_as::<_, PaymentRow>(
        "select p.id, p.booking_id, p.type, p.amount_cents, p.method, p.created_at, b.reference \
         from payment p join booking b on b.id = p.booking_id \
         where ((p.type in ('deposit','balance') and p.status = 'succeeded') \
                or (p.type = 'caution_capture' and p.status in ('captured','succeeded')) \
                or (p.type = 'refund' and p.status <> 'failed')) \
           and p.amount_cents > 0 \
           and not exists (select 1 from ledger_entry e \
                           where e.source_type = 'payment' and e.source_id = p.id::text) \
         order by p.created_at",
    )
    .fetch_all(pool)
    .await?;
    for p in payments {
        let mut tx = pool.begin().await?;
        let clients = account_id_by_code(&mut tx, ACC_CLIENTS).await?;
        let bank_code = match p.method.as_deref() {
            Some("cheque") | Some("virement") => ACC_BANQUE,
            _ => ACC_STRIPE,
        };
        let bank = account_id_by_code(&mut tx, bank_code).await?;
        let (label, lines) = match p.r#type.as_str() {
            "deposit" => (
                format!("Acompte {}", p.reference),
                vec![
                    LineSpec::debit(bank, p.amount_cents).with_booking(p.booking_id),
                    LineSpec::credit(clients, p.amount_cents).with_booking(p.booking_id),
                ],
            ),
            "balance" => (
                format!("Solde {}", p.reference),
                vec![
                    LineSpec::debit(bank, p.amount_cents).with_booking(p.booking_id),
                    LineSpec::credit(clients, p.amount_cents).with_booking(p.booking_id),
                ],
            ),
            "caution_capture" => {
                let indemnites = account_id_by_code(&mut tx, ACC_INDEMNITES).await?;
                (
                    format!("Caution retenue {}", p.reference),
                    vec![
                        LineSpec::debit(bank, p.amount_cents).with_booking(p.booking_id),
                        LineSpec::credit(indemnites, p.amount_cents).with_booking(p.booking_id),
                    ],
                )
            }
            "refund" => (
                format!("Remboursement {}", p.reference),
                vec![
                    LineSpec::debit(clients, p.amount_cents).with_booking(p.booking_id),
                    LineSpec::credit(bank, p.amount_cents).with_booking(p.booking_id),
                ],
            ),
            _ => {
                tx.commit().await?;
                continue;
            }
        };
        insert_entry(
            &mut tx,
            "BQ",
            crate::paris_date(p.created_at),
            &label,
            Some(("payment", p.id.to_string())),
            None,
            None,
            &lines,
        )
        .await?;
        tx.commit().await?;
        created += 1;
    }

    // 3) Avoirs d'annulation : la créance restante (facture − encaissé net) est
    //    annulée, imputée d'abord sur la taxe de séjour non collectée, puis les
    //    prestations, puis le loyer. Après l'avoir, le compte client du dossier
    //    revient à zéro.
    #[derive(FromRow)]
    struct CancelRow {
        id: Uuid,
        reference: String,
        week_price_cents: i64,
        extras_total_cents: i64,
        tourist_tax_cents: i64,
        cancelled_at: chrono::DateTime<Utc>,
        paid_net_cents: i64,
        balance_paid: bool,
    }
    let cancels = sqlx::query_as::<_, CancelRow>(
        "select b.id, b.reference, b.week_price_cents, b.extras_total_cents, b.tourist_tax_cents, \
                b.cancelled_at, (b.balance_paid_at is not null) as balance_paid, \
                coalesce((select sum(case when p.type in ('deposit','balance') and p.status='succeeded' \
                                          then p.amount_cents \
                                          when p.type='refund' and p.status <> 'failed' \
                                          then -p.amount_cents else 0 end) \
                          from payment p where p.booking_id = b.id),0)::bigint as paid_net_cents \
         from booking b \
         where b.status = 'cancelled' and b.cancelled_at is not null and b.deposit_paid_at is not null \
           and exists (select 1 from ledger_entry e \
                       where e.source_type = 'booking_invoice' and e.source_id = b.id::text) \
           and not exists (select 1 from ledger_entry e \
                           where e.source_type = 'booking_cancel' and e.source_id = b.id::text)",
    )
    .fetch_all(pool)
    .await?;
    for b in cancels {
        let invoice_total = b.week_price_cents + b.extras_total_cents + b.tourist_tax_cents;
        let mut remaining = invoice_total - b.paid_net_cents;
        if remaining <= 0 {
            continue;
        }
        let mut tx = pool.begin().await?;
        let clients = account_id_by_code(&mut tx, ACC_CLIENTS).await?;
        let loyers = account_id_by_code(&mut tx, ACC_LOYERS).await?;
        let prestations = account_id_by_code(&mut tx, ACC_PRESTATIONS).await?;
        let taxe = account_id_by_code(&mut tx, ACC_TAXE_SEJOUR).await?;
        let credit_total = remaining;
        let mut lines: Vec<LineSpec> = Vec::new();
        // La taxe de séjour n'est due que si elle a été collectée (solde payé).
        if !b.balance_paid && b.tourist_tax_cents > 0 {
            let part = remaining.min(b.tourist_tax_cents);
            if part > 0 {
                lines.push(LineSpec::debit(taxe, part).with_booking(b.id));
                remaining -= part;
            }
        }
        if remaining > 0 && b.extras_total_cents > 0 {
            let part = remaining.min(b.extras_total_cents);
            lines.push(LineSpec::debit(prestations, part).with_booking(b.id));
            remaining -= part;
        }
        if remaining > 0 {
            lines.push(LineSpec::debit(loyers, remaining).with_booking(b.id));
        }
        lines.push(LineSpec::credit(clients, credit_total).with_booking(b.id));
        insert_entry(
            &mut tx,
            "VE",
            crate::paris_date(b.cancelled_at),
            &format!("Avoir annulation {}", b.reference),
            Some(("booking_cancel", b.id.to_string())),
            None,
            None,
            &lines,
        )
        .await?;
        tx.commit().await?;
        created += 1;
    }

    Ok(created)
}

async fn sync_now(State(st): State<AppState>) -> Result<Json<serde_json::Value>, AppError> {
    let created = sync_ledger(&st.pool).await?;
    Ok(Json(serde_json::json!({ "created": created })))
}

// ---------------------------------------------------------------------------
// Trésorerie
// ---------------------------------------------------------------------------

#[derive(Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
struct TreasuryAccount {
    account_id: Uuid,
    code: String,
    name: String,
    balance_cents: i64,
}

#[derive(Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
struct MonthFlow {
    month: String,
    in_cents: i64,
    out_cents: i64,
}

#[derive(Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
struct UpcomingIn {
    reference: String,
    customer_name: Option<String>,
    due_date: NaiveDate,
    amount_cents: i64,
}

#[derive(Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
struct UpcomingOut {
    id: Uuid,
    supplier_name: String,
    label: String,
    due_date: Option<NaiveDate>,
    amount_cents: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CashflowResponse {
    accounts: Vec<TreasuryAccount>,
    total_cents: i64,
    monthly: Vec<MonthFlow>,
    upcoming_in: Vec<UpcomingIn>,
    upcoming_out: Vec<UpcomingOut>,
    upcoming_in_total_cents: i64,
    upcoming_out_total_cents: i64,
}

async fn cashflow(State(st): State<AppState>) -> Result<Json<CashflowResponse>, AppError> {
    // Soldes des comptes de trésorerie (classe 5).
    let accounts = sqlx::query_as::<_, TreasuryAccount>(
        "select a.id as account_id, a.code, a.name, \
                coalesce(sum(l.debit_cents - l.credit_cents),0)::bigint as balance_cents \
         from account a left join ledger_line l on l.account_id = a.id \
         where a.code like '5%' and a.is_active \
         group by a.id, a.code, a.name \
         having a.is_system or coalesce(sum(l.debit_cents - l.credit_cents),0) <> 0 \
         order by a.code",
    )
    .fetch_all(&st.pool)
    .await?;
    let total: i64 = accounts.iter().map(|a| a.balance_cents).sum();

    // Flux mensuels sur 12 mois : débits classe 5 = encaissements, crédits =
    // décaissements. Les virements internes (écriture dont débit ET crédit
    // touchent la classe 5) sont exclus.
    let monthly = sqlx::query_as::<_, MonthFlow>(
        "with t5 as ( \
           select e.id as entry_id, e.entry_date, l.debit_cents, l.credit_cents \
           from ledger_line l \
           join ledger_entry e on e.id = l.entry_id \
           join account a on a.id = l.account_id \
           where a.code like '5%' \
             and e.entry_date >= (date_trunc('month', current_date) - interval '11 months')::date \
         ), internal as ( \
           select entry_id from t5 group by entry_id \
           having sum(debit_cents) > 0 and sum(credit_cents) > 0 \
         ) \
         select to_char(date_trunc('month', entry_date), 'YYYY-MM') as month, \
                coalesce(sum(debit_cents),0)::bigint as in_cents, \
                coalesce(sum(credit_cents),0)::bigint as out_cents \
         from t5 where entry_id not in (select entry_id from internal) \
         group by 1 order by 1",
    )
    .fetch_all(&st.pool)
    .await?;

    // Prévisionnel entrées : soldes clients des dossiers confirmés (prélèvement
    // à J-14 avant l'arrivée), tant que le solde n'est pas encaissé.
    let upcoming_in = sqlx::query_as::<_, UpcomingIn>(
        "select b.reference, \
                nullif(trim(coalesce(c.first_name,'') || ' ' || coalesce(c.last_name,'')), '') as customer_name, \
                (aw.start_date - 14) as due_date, b.balance_cents as amount_cents \
         from booking b \
         join availability_week aw on aw.id = b.week_id \
         left join customer c on c.id = b.customer_id \
         where b.status = 'confirmed' and b.balance_paid_at is null and b.balance_cents > 0 \
         order by aw.start_date",
    )
    .fetch_all(&st.pool)
    .await?;

    // Prévisionnel sorties : factures fournisseurs à payer, par échéance.
    let upcoming_out = sqlx::query_as::<_, UpcomingOut>(
        "select i.id, s.name as supplier_name, i.label, \
                coalesce(i.due_date, i.invoice_date) as due_date, i.amount_cents \
         from supplier_invoice i join supplier s on s.id = i.supplier_id \
         where i.status = 'a_payer' \
         order by coalesce(i.due_date, i.invoice_date)",
    )
    .fetch_all(&st.pool)
    .await?;

    let in_total: i64 = upcoming_in.iter().map(|r| r.amount_cents).sum();
    let out_total: i64 = upcoming_out.iter().map(|r| r.amount_cents).sum();

    Ok(Json(CashflowResponse {
        accounts,
        total_cents: total,
        monthly,
        upcoming_in,
        upcoming_out,
        upcoming_in_total_cents: in_total,
        upcoming_out_total_cents: out_total,
    }))
}

// ---------------------------------------------------------------------------
// Bilans : rapport annuel (résultat + bilan simplifié) et rapport de saison
// ---------------------------------------------------------------------------

#[derive(Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
struct ReportLine {
    code: String,
    name: String,
    cents: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ReportMeta {
    years: Vec<i32>,
    seasons: Vec<SeasonRef>,
}

#[derive(Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
struct SeasonRef {
    id: Uuid,
    name: String,
    start_date: NaiveDate,
    end_date: NaiveDate,
}

/// Années ayant des écritures + saisons disponibles, pour les sélecteurs.
async fn report_meta(State(st): State<AppState>) -> Result<Json<ReportMeta>, AppError> {
    let mut years: Vec<i32> = sqlx::query_scalar(
        "select distinct extract(year from entry_date)::int from ledger_entry order by 1 desc",
    )
    .fetch_all(&st.pool)
    .await?;
    let current = crate::paris_today().year();
    if !years.contains(&current) {
        years.insert(0, current);
    }
    let seasons = sqlx::query_as::<_, SeasonRef>(
        "select id, name, start_date, end_date from season order by start_date desc",
    )
    .fetch_all(&st.pool)
    .await?;
    Ok(Json(ReportMeta { years, seasons }))
}

/// Produits (classe 7, crédit − débit) et charges (classe 6, débit − crédit)
/// entre deux dates, par compte.
async fn resultat_lines(
    pool: &PgPool,
    from: NaiveDate,
    to: NaiveDate,
) -> Result<(Vec<ReportLine>, Vec<ReportLine>), AppError> {
    let produits = sqlx::query_as::<_, ReportLine>(
        "select a.code, a.name, sum(l.credit_cents - l.debit_cents)::bigint as cents \
         from ledger_line l join ledger_entry e on e.id = l.entry_id \
         join account a on a.id = l.account_id \
         where a.code like '7%' and e.entry_date between $1 and $2 \
         group by a.code, a.name having sum(l.credit_cents - l.debit_cents) <> 0 \
         order by a.code",
    )
    .bind(from)
    .bind(to)
    .fetch_all(pool)
    .await?;
    let charges = sqlx::query_as::<_, ReportLine>(
        "select a.code, a.name, sum(l.debit_cents - l.credit_cents)::bigint as cents \
         from ledger_line l join ledger_entry e on e.id = l.entry_id \
         join account a on a.id = l.account_id \
         where a.code like '6%' and e.entry_date between $1 and $2 \
         group by a.code, a.name having sum(l.debit_cents - l.credit_cents) <> 0 \
         order by a.code",
    )
    .bind(from)
    .bind(to)
    .fetch_all(pool)
    .await?;
    Ok((produits, charges))
}

#[derive(Deserialize)]
struct YearQuery {
    year: i32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct YearReport {
    label: String,
    from: NaiveDate,
    to: NaiveDate,
    produits: Vec<ReportLine>,
    charges: Vec<ReportLine>,
    total_produits_cents: i64,
    total_charges_cents: i64,
    resultat_cents: i64,
    /// Bilan simplifié au 31/12 : soldes cumulés des classes 1 à 5.
    actif: Vec<ReportLine>,
    passif: Vec<ReportLine>,
    total_actif_cents: i64,
    total_passif_cents: i64,
    /// Flux de trésorerie de l'année (hors virements internes).
    in_cents: i64,
    out_cents: i64,
}

async fn report_year(
    State(st): State<AppState>,
    Query(q): Query<YearQuery>,
) -> Result<Json<YearReport>, AppError> {
    let from = NaiveDate::from_ymd_opt(q.year, 1, 1)
        .ok_or_else(|| AppError::BadRequest("Année invalide.".into()))?;
    let to = NaiveDate::from_ymd_opt(q.year, 12, 31).unwrap();

    let (produits, charges) = resultat_lines(&st.pool, from, to).await?;
    let total_produits: i64 = produits.iter().map(|l| l.cents).sum();
    let total_charges: i64 = charges.iter().map(|l| l.cents).sum();

    // Bilan simplifié : soldes cumulés jusqu'au 31/12 des comptes de bilan
    // (classes 1-5). Solde débiteur → actif, créditeur → passif. Le résultat
    // cumulé (produits − charges depuis l'origine) équilibre le passif.
    let bilan_rows = sqlx::query_as::<_, ReportLine>(
        "select a.code, a.name, sum(l.debit_cents - l.credit_cents)::bigint as cents \
         from ledger_line l join ledger_entry e on e.id = l.entry_id \
         join account a on a.id = l.account_id \
         where a.code not like '6%' and a.code not like '7%' and e.entry_date <= $1 \
         group by a.code, a.name having sum(l.debit_cents - l.credit_cents) <> 0 \
         order by a.code",
    )
    .bind(to)
    .fetch_all(&st.pool)
    .await?;
    let mut actif: Vec<ReportLine> = Vec::new();
    let mut passif: Vec<ReportLine> = Vec::new();
    for r in bilan_rows {
        if r.cents > 0 {
            actif.push(r);
        } else {
            passif.push(ReportLine {
                code: r.code,
                name: r.name,
                cents: -r.cents,
            });
        }
    }
    // Résultat cumulé depuis l'origine (produits − charges) : c'est lui qui
    // équilibre le bilan côté passif.
    let cumul: i64 = sqlx::query_scalar(
        "select coalesce(sum(case when a.code like '7%' then l.credit_cents - l.debit_cents \
                                  else l.credit_cents - l.debit_cents end),0)::bigint \
         from ledger_line l join ledger_entry e on e.id = l.entry_id \
         join account a on a.id = l.account_id \
         where (a.code like '6%' or a.code like '7%') and e.entry_date <= $1",
    )
    .bind(to)
    .fetch_one(&st.pool)
    .await?;
    if cumul != 0 {
        passif.push(ReportLine {
            code: "120000".into(),
            name: "Résultat cumulé (bénéfice ou perte)".into(),
            cents: cumul,
        });
    }
    let total_actif: i64 = actif.iter().map(|l| l.cents).sum();
    let total_passif: i64 = passif.iter().map(|l| l.cents).sum();

    // Flux de trésorerie de l'année, virements internes exclus (même logique
    // que la vue trésorerie).
    let (inflow, outflow): (i64, i64) = sqlx::query_as(
        "with t5 as ( \
           select e.id as entry_id, l.debit_cents, l.credit_cents \
           from ledger_line l \
           join ledger_entry e on e.id = l.entry_id \
           join account a on a.id = l.account_id \
           where a.code like '5%' and e.entry_date between $1 and $2 \
         ), internal as ( \
           select entry_id from t5 group by entry_id \
           having sum(debit_cents) > 0 and sum(credit_cents) > 0 \
         ) \
         select coalesce(sum(debit_cents),0)::bigint, coalesce(sum(credit_cents),0)::bigint \
         from t5 where entry_id not in (select entry_id from internal)",
    )
    .bind(from)
    .bind(to)
    .fetch_one(&st.pool)
    .await?;

    Ok(Json(YearReport {
        label: format!("Exercice {}", q.year),
        from,
        to,
        produits,
        charges,
        total_produits_cents: total_produits,
        total_charges_cents: total_charges,
        resultat_cents: total_produits - total_charges,
        actif,
        passif,
        total_actif_cents: total_actif,
        total_passif_cents: total_passif,
        in_cents: inflow,
        out_cents: outflow,
    }))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SeasonQuery {
    season_id: Uuid,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SeasonReport {
    label: String,
    from: NaiveDate,
    to: NaiveDate,
    /// Produits rattachés aux réservations de la saison (quelle que soit la
    /// date d'écriture : un acompte encaissé six mois avant compte pour sa saison).
    produits: Vec<ReportLine>,
    /// Charges datées pendant la saison (les factures ne sont pas rattachées
    /// à une saison — l'imputation se fait par la période).
    charges: Vec<ReportLine>,
    total_produits_cents: i64,
    total_charges_cents: i64,
    resultat_cents: i64,
    /// Encaissé net en trésorerie sur les dossiers de la saison.
    collected_cents: i64,
    /// Taxe de séjour des dossiers de la saison (collectée pour la commune).
    tax_cents: i64,
    weeks_total: i64,
    weeks_booked: i64,
    revenue_booked_cents: i64,
}

async fn report_season(
    State(st): State<AppState>,
    Query(q): Query<SeasonQuery>,
) -> Result<Json<SeasonReport>, AppError> {
    let season = sqlx::query_as::<_, SeasonRef>(
        "select id, name, start_date, end_date from season where id = $1",
    )
    .bind(q.season_id)
    .fetch_optional(&st.pool)
    .await?
    .ok_or_else(|| AppError::NotFound("saison".into()))?;

    // Produits par compte, via les lignes rattachées aux dossiers de la saison.
    let produits = sqlx::query_as::<_, ReportLine>(
        "select a.code, a.name, sum(l.credit_cents - l.debit_cents)::bigint as cents \
         from ledger_line l \
         join account a on a.id = l.account_id \
         join booking b on b.id = l.booking_id \
         join availability_week w on w.id = b.week_id \
         where a.code like '7%' and w.season_id = $1 \
         group by a.code, a.name having sum(l.credit_cents - l.debit_cents) <> 0 \
         order by a.code",
    )
    .bind(season.id)
    .fetch_all(&st.pool)
    .await?;

    let charges = sqlx::query_as::<_, ReportLine>(
        "select a.code, a.name, sum(l.debit_cents - l.credit_cents)::bigint as cents \
         from ledger_line l join ledger_entry e on e.id = l.entry_id \
         join account a on a.id = l.account_id \
         where a.code like '6%' and e.entry_date between $1 and $2 \
         group by a.code, a.name having sum(l.debit_cents - l.credit_cents) <> 0 \
         order by a.code",
    )
    .bind(season.start_date)
    .bind(season.end_date)
    .fetch_all(&st.pool)
    .await?;

    // Encaissé net (classe 5) et taxe de séjour (447800) des dossiers de la saison.
    let (collected, tax): (i64, i64) = sqlx::query_as(
        "select \
           coalesce(sum(l.debit_cents - l.credit_cents) filter (where a.code like '5%'),0)::bigint, \
           coalesce(sum(l.credit_cents - l.debit_cents) filter (where a.code = '447800'),0)::bigint \
         from ledger_line l \
         join account a on a.id = l.account_id \
         join booking b on b.id = l.booking_id \
         join availability_week w on w.id = b.week_id \
         where w.season_id = $1",
    )
    .bind(season.id)
    .fetch_one(&st.pool)
    .await?;

    let (weeks_total, weeks_booked, revenue_booked): (i64, i64, i64) = sqlx::query_as(
        "select count(*)::bigint, \
                count(*) filter (where status = 'booked')::bigint, \
                coalesce(sum(price_cents) filter (where status = 'booked'),0)::bigint \
         from availability_week where season_id = $1",
    )
    .bind(season.id)
    .fetch_one(&st.pool)
    .await?;

    let total_produits: i64 = produits.iter().map(|l| l.cents).sum();
    let total_charges: i64 = charges.iter().map(|l| l.cents).sum();

    Ok(Json(SeasonReport {
        label: season.name,
        from: season.start_date,
        to: season.end_date,
        produits,
        charges,
        total_produits_cents: total_produits,
        total_charges_cents: total_charges,
        resultat_cents: total_produits - total_charges,
        collected_cents: collected,
        tax_cents: tax,
        weeks_total,
        weeks_booked,
        revenue_booked_cents: revenue_booked,
    }))
}
