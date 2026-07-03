//! Campagnes e-mails : ciblage de contacts par critères (clients/prospects,
//! séjour à venir, ancienneté, ville…), liste de destinataires figée à la
//! création (snapshot), envoi via le module email (loggé dans email_log,
//! kind "campaign"). Les campagnes sont un canal marketing explicite : elles
//! ignorent volontairement la coupure des transactionnels automatiques.

use crate::{admin::AdminId, email, error::AppError, AppState};
use axum::{
    extract::{Extension, Path, State},
    http::StatusCode,
    routing::{get, post},
    Json, Router,
};
use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, PgPool};
use uuid::Uuid;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/campaigns", get(list_campaigns).post(create_campaign))
        .route("/campaigns/preview", post(preview_recipients))
        .route(
            "/campaigns/:id",
            get(campaign_detail)
                .put(update_campaign)
                .delete(delete_campaign),
        )
        .route("/campaigns/:id/send", post(send_campaign))
}

// ---------------------------------------------------------------------------
// Ciblage
// ---------------------------------------------------------------------------

/// Critères de ciblage. Tous optionnels — vide = tous les contacts avec e-mail.
#[derive(Serialize, Deserialize, Default, Clone)]
#[serde(rename_all = "camelCase", default)]
pub struct CampaignFilters {
    /// "all" (défaut) | "clients" (≥ 1 séjour confirmé) | "prospects" (paniers
    /// seulement, jamais confirmé).
    pub audience: Option<String>,
    /// true = a un séjour confirmé à venir ; false = n'en a pas.
    pub upcoming: Option<bool>,
    /// Nombre minimal de séjours confirmés (fidélité).
    pub min_stays: Option<i64>,
    /// Dernière activité (résa/panier) dans la fenêtre donnée.
    pub last_activity_after: Option<NaiveDate>,
    pub last_activity_before: Option<NaiveDate>,
    /// Ville contient (insensible à la casse).
    pub city: Option<String>,
    /// Liste explicite de contacts (sélection manuelle depuis la page
    /// Contacts) : si présente et non vide, elle remplace tous les autres
    /// critères.
    pub customer_ids: Option<Vec<Uuid>>,
}

#[derive(Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
struct RecipientDto {
    customer_id: Uuid,
    email: String,
    first_name: String,
    last_name: String,
}

/// Contacts correspondant aux critères — dédupliqués par e-mail.
async fn resolve_recipients(
    pool: &PgPool,
    f: &CampaignFilters,
) -> Result<Vec<RecipientDto>, AppError> {
    // Sélection manuelle : la liste prime sur les critères.
    if let Some(ids) = f.customer_ids.as_ref().filter(|v| !v.is_empty()) {
        let rows = sqlx::query_as::<_, RecipientDto>(
            "select distinct on (lower(c.email)) \
                    c.id as customer_id, c.email, c.first_name, c.last_name \
             from customer c \
             where c.id = any($1) and coalesce(trim(c.email), '') <> '' \
             order by lower(c.email), c.created_at desc",
        )
        .bind(ids)
        .fetch_all(pool)
        .await?;
        return Ok(rows);
    }
    let audience = f.audience.as_deref().unwrap_or("all");
    if !["all", "clients", "prospects"].contains(&audience) {
        return Err(AppError::BadRequest("Audience invalide.".into()));
    }
    let rows = sqlx::query_as::<_, RecipientDto>(
        "select distinct on (lower(c.email)) \
                c.id as customer_id, c.email, c.first_name, c.last_name \
         from customer c \
         where coalesce(trim(c.email), '') <> '' \
           and (coalesce($2, '') = '' or c.city ilike '%' || $2 || '%') \
           and (case $1 \
                  when 'clients' then exists (select 1 from booking b where b.customer_id = c.id \
                       and b.status in ('confirmed','balance_paid')) \
                  when 'prospects' then not exists (select 1 from booking b where b.customer_id = c.id \
                       and b.status in ('confirmed','balance_paid')) \
                       and exists (select 1 from booking b where b.customer_id = c.id) \
                  else true end) \
           and ($3::bool is null or $3 = exists (select 1 from booking b \
                    join availability_week aw on aw.id = b.week_id \
                    where b.customer_id = c.id and b.status in ('confirmed','balance_paid') \
                      and aw.start_date >= current_date)) \
           and ($4::bigint is null or $4 <= (select count(*) from booking b where b.customer_id = c.id \
                    and b.status in ('confirmed','balance_paid'))) \
           and ($5::date is null or coalesce((select max(b.updated_at) from booking b \
                    where b.customer_id = c.id), c.created_at)::date >= $5) \
           and ($6::date is null or coalesce((select max(b.updated_at) from booking b \
                    where b.customer_id = c.id), c.created_at)::date <= $6) \
         order by lower(c.email), c.created_at desc",
    )
    .bind(audience)
    .bind(f.city.as_deref().map(str::trim).unwrap_or(""))
    .bind(f.upcoming)
    .bind(f.min_stays)
    .bind(f.last_activity_after)
    .bind(f.last_activity_before)
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

#[derive(Deserialize)]
struct PreviewInput {
    #[serde(default)]
    filters: CampaignFilters,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PreviewResponse {
    count: i64,
    sample: Vec<RecipientDto>,
}

async fn preview_recipients(
    State(st): State<AppState>,
    Json(body): Json<PreviewInput>,
) -> Result<Json<PreviewResponse>, AppError> {
    let mut all = resolve_recipients(&st.pool, &body.filters).await?;
    let count = all.len() as i64;
    all.truncate(25);
    Ok(Json(PreviewResponse { count, sample: all }))
}

// ---------------------------------------------------------------------------
// CRUD campagnes
// ---------------------------------------------------------------------------

#[derive(Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
struct CampaignDto {
    id: Uuid,
    subject: String,
    status: String,
    recipient_count: i32,
    sent_count: i64,
    created_at: DateTime<Utc>,
    sent_at: Option<DateTime<Utc>>,
}

async fn list_campaigns(State(st): State<AppState>) -> Result<Json<Vec<CampaignDto>>, AppError> {
    let rows = sqlx::query_as::<_, CampaignDto>(
        "select c.id, c.subject, c.status, c.recipient_count, \
                (select count(*) from email_campaign_recipient r \
                 where r.campaign_id = c.id and r.status = 'sent') as sent_count, \
                c.created_at, c.sent_at \
         from email_campaign c order by c.created_at desc",
    )
    .fetch_all(&st.pool)
    .await?;
    Ok(Json(rows))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CampaignInput {
    subject: String,
    body: String,
    #[serde(default)]
    filters: CampaignFilters,
}

/// Fige la liste des destinataires d'une campagne à partir de ses filtres.
async fn snapshot_recipients(
    pool: &PgPool,
    campaign_id: Uuid,
    filters: &CampaignFilters,
) -> Result<i64, AppError> {
    let recipients = resolve_recipients(pool, filters).await?;
    let mut tx = pool.begin().await?;
    sqlx::query(
        "delete from email_campaign_recipient where campaign_id = $1 and status = 'pending'",
    )
    .bind(campaign_id)
    .execute(&mut *tx)
    .await?;
    let mut n = 0i64;
    for r in &recipients {
        let inserted = sqlx::query(
            "insert into email_campaign_recipient \
             (campaign_id, customer_id, email, first_name, last_name) \
             values ($1,$2,$3,$4,$5) on conflict (campaign_id, email) do nothing",
        )
        .bind(campaign_id)
        .bind(r.customer_id)
        .bind(&r.email)
        .bind(&r.first_name)
        .bind(&r.last_name)
        .execute(&mut *tx)
        .await?
        .rows_affected();
        n += inserted as i64;
    }
    let total: i64 =
        sqlx::query_scalar("select count(*) from email_campaign_recipient where campaign_id = $1")
            .bind(campaign_id)
            .fetch_one(&mut *tx)
            .await?;
    sqlx::query("update email_campaign set recipient_count = $2 where id = $1")
        .bind(campaign_id)
        .bind(total as i32)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(n)
}

async fn create_campaign(
    State(st): State<AppState>,
    Extension(admin): Extension<AdminId>,
    Json(body): Json<CampaignInput>,
) -> Result<Json<serde_json::Value>, AppError> {
    if body.subject.trim().is_empty() || body.body.trim().is_empty() {
        return Err(AppError::BadRequest("Sujet et message requis.".into()));
    }
    let id: Uuid = sqlx::query_scalar(
        "insert into email_campaign (subject, body, filters, created_by) \
         values ($1,$2,$3,$4) returning id",
    )
    .bind(body.subject.trim())
    .bind(body.body.trim())
    .bind(serde_json::to_value(&body.filters).unwrap_or_default())
    .bind(admin.0)
    .fetch_one(&st.pool)
    .await?;
    snapshot_recipients(&st.pool, id, &body.filters).await?;
    Ok(Json(serde_json::json!({ "id": id })))
}

async fn update_campaign(
    State(st): State<AppState>,
    Path(id): Path<Uuid>,
    Json(body): Json<CampaignInput>,
) -> Result<StatusCode, AppError> {
    if body.subject.trim().is_empty() || body.body.trim().is_empty() {
        return Err(AppError::BadRequest("Sujet et message requis.".into()));
    }
    let n = sqlx::query(
        "update email_campaign set subject=$2, body=$3, filters=$4 \
         where id=$1 and status='draft'",
    )
    .bind(id)
    .bind(body.subject.trim())
    .bind(body.body.trim())
    .bind(serde_json::to_value(&body.filters).unwrap_or_default())
    .execute(&st.pool)
    .await?
    .rows_affected();
    if n == 0 {
        return Err(AppError::BadRequest(
            "Campagne introuvable ou déjà envoyée.".into(),
        ));
    }
    snapshot_recipients(&st.pool, id, &body.filters).await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn delete_campaign(
    State(st): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, AppError> {
    let n = sqlx::query("delete from email_campaign where id = $1 and status = 'draft'")
        .bind(id)
        .execute(&st.pool)
        .await?
        .rows_affected();
    if n == 0 {
        return Err(AppError::BadRequest(
            "Campagne introuvable ou déjà envoyée (l'historique est conservé).".into(),
        ));
    }
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
struct CampaignFull {
    id: Uuid,
    subject: String,
    body: String,
    filters: serde_json::Value,
    status: String,
    recipient_count: i32,
    created_at: DateTime<Utc>,
    sent_at: Option<DateTime<Utc>>,
}

#[derive(Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
struct CampaignRecipientDto {
    email: String,
    first_name: String,
    last_name: String,
    status: String,
    sent_at: Option<DateTime<Utc>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CampaignDetail {
    #[serde(flatten)]
    campaign: CampaignFull,
    recipients: Vec<CampaignRecipientDto>,
}

async fn campaign_detail(
    State(st): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<CampaignDetail>, AppError> {
    let campaign = sqlx::query_as::<_, CampaignFull>(
        "select id, subject, body, filters, status, recipient_count, created_at, sent_at \
         from email_campaign where id = $1",
    )
    .bind(id)
    .fetch_optional(&st.pool)
    .await?
    .ok_or_else(|| AppError::NotFound("campagne".into()))?;
    let recipients = sqlx::query_as::<_, CampaignRecipientDto>(
        "select email, first_name, last_name, status, sent_at \
         from email_campaign_recipient where campaign_id = $1 order by lower(email)",
    )
    .bind(id)
    .fetch_all(&st.pool)
    .await?;
    Ok(Json(CampaignDetail {
        campaign,
        recipients,
    }))
}

// ---------------------------------------------------------------------------
// Envoi
// ---------------------------------------------------------------------------

/// Envoie la campagne aux destinataires en attente. Idempotent : relancer
/// n'envoie qu'aux `pending` (reprise après interruption). Variables
/// disponibles dans le sujet et le corps : {{prenom}}, {{nom}}, {{bonjour}}.
async fn send_campaign(
    State(st): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, AppError> {
    let campaign = sqlx::query_as::<_, (String, String, String)>(
        "select subject, body, status from email_campaign where id = $1",
    )
    .bind(id)
    .fetch_optional(&st.pool)
    .await?
    .ok_or_else(|| AppError::NotFound("campagne".into()))?;
    let pending = sqlx::query_as::<_, (Uuid, String, String, String)>(
        "select id, email, first_name, last_name from email_campaign_recipient \
         where campaign_id = $1 and status = 'pending' order by lower(email)",
    )
    .bind(id)
    .fetch_all(&st.pool)
    .await?;
    if pending.is_empty() {
        return Err(AppError::BadRequest(
            "Aucun destinataire en attente pour cette campagne.".into(),
        ));
    }

    let (site, location) = email::brand(&st.pool).await;
    let mut sent = 0i64;
    for (rid, to, first_name, last_name) in pending {
        let vars: Vec<(&str, String)> = vec![
            ("bonjour", email::bonjour(Some(&first_name))),
            ("prenom", first_name.clone()),
            ("nom", last_name.clone()),
        ];
        let subject = email::render_template(&campaign.0, &vars, false);
        let body_html = email::render_email_body(&campaign.1, &vars);
        let heading = subject.clone();
        let html = email::template(&site, &location, &heading, &body_html, "", "");
        email::spawn(st.pool.clone(), None, "campaign", to, subject, html);
        sqlx::query(
            "update email_campaign_recipient set status = 'sent', sent_at = now() where id = $1",
        )
        .bind(rid)
        .execute(&st.pool)
        .await?;
        sent += 1;
    }
    sqlx::query(
        "update email_campaign set status = 'sent', sent_at = coalesce(sent_at, now()) \
         where id = $1",
    )
    .bind(id)
    .execute(&st.pool)
    .await?;
    Ok(Json(serde_json::json!({ "sent": sent })))
}
