//! Back-office: authentification par sessions (cookie HttpOnly) + endpoints
//! d'administration (éditorial, dispos/tarifs, prestations, réservations).

use crate::{error::AppError, AppState};
use argon2::password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString};
use argon2::Argon2;
use axum::{
    extract::{DefaultBodyLimit, Extension, Multipart, Path, Query, Request, State},
    http::{header, HeaderMap, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, post, put},
    Json, Router,
};
use chrono::{DateTime, Datelike, Duration, NaiveDate, Utc, Weekday};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

const SESSION_DAYS: i64 = 30;

#[derive(Clone)]
pub struct AdminId(pub Uuid);

pub fn routes(state: AppState) -> Router {
    let protected = Router::new()
        .route("/me", get(me))
        .route("/property/:slug", get(get_property).put(update_property))
        .route("/property/:slug/media", get(list_media).post(upload_media))
        .route("/media/:id", put(update_media).delete(delete_media))
        .route("/seasons", get(list_seasons).post(create_season))
        .route("/seasons/:id", put(update_season).delete(delete_season))
        .route("/weeks", get(list_weeks))
        .route("/weeks/generate", post(generate_weeks))
        .route("/weeks/:id", put(update_week).delete(delete_week))
        .route("/products", get(list_products).post(create_product))
        .route("/products/:id", put(update_product).delete(delete_product))
        .route("/bookings", get(list_bookings))
        .route("/bookings/:reference/signature", get(get_signature))
        .route("/bookings/:reference/cancel", post(cancel_booking))
        .route(
            "/bookings/:reference/caution/capture",
            post(capture_caution),
        )
        .route(
            "/bookings/:reference/caution/release",
            post(release_caution),
        )
        .route("/bookings/:reference/refund", post(refund_payment))
        .route("/scheduler/run", post(run_scheduler))
        .layer(DefaultBodyLimit::max(12 * 1024 * 1024))
        .route_layer(middleware::from_fn_with_state(state.clone(), require_admin));

    Router::new()
        .route("/login", post(login))
        .route("/logout", post(logout))
        .merge(protected)
        .with_state(state)
}

// ---------------------------------------------------------------------------
// Password hashing & tokens
// ---------------------------------------------------------------------------

pub fn hash_password(password: &str) -> anyhow::Result<String> {
    let mut salt_bytes = [0u8; 16];
    rand::thread_rng().fill_bytes(&mut salt_bytes);
    let salt = SaltString::encode_b64(&salt_bytes).map_err(|e| anyhow::anyhow!(e.to_string()))?;
    let hash = Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map_err(|e| anyhow::anyhow!(e.to_string()))?
        .to_string();
    Ok(hash)
}

fn verify_password(hash: &str, password: &str) -> bool {
    match PasswordHash::new(hash) {
        Ok(parsed) => Argon2::default()
            .verify_password(password.as_bytes(), &parsed)
            .is_ok(),
        Err(_) => false,
    }
}

fn new_token() -> String {
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

// ---------------------------------------------------------------------------
// Auth middleware
// ---------------------------------------------------------------------------

#[derive(FromRow)]
struct SessionRow {
    admin_user_id: Uuid,
}

async fn require_admin(
    State(st): State<AppState>,
    mut req: Request,
    next: Next,
) -> Result<Response, AppError> {
    let token = req
        .headers()
        .get(header::COOKIE)
        .and_then(|v| v.to_str().ok())
        .and_then(session_cookie);

    let Some(token) = token else {
        return Ok(unauthorized());
    };

    let session = sqlx::query_as::<_, SessionRow>(
        "select admin_user_id from admin_session where token = $1 and expires_at > now()",
    )
    .bind(&token)
    .fetch_optional(&st.pool)
    .await?;

    match session {
        Some(s) => {
            req.extensions_mut().insert(AdminId(s.admin_user_id));
            Ok(next.run(req).await)
        }
        None => Ok(unauthorized()),
    }
}

fn session_cookie(header_value: &str) -> Option<String> {
    header_value.split(';').find_map(|part| {
        let part = part.trim();
        part.strip_prefix("session=").map(|v| v.to_string())
    })
}

fn unauthorized() -> Response {
    (
        StatusCode::UNAUTHORIZED,
        Json(serde_json::json!({ "error": "Non authentifié" })),
    )
        .into_response()
}

// ---------------------------------------------------------------------------
// Login / logout / me
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct LoginInput {
    email: String,
    password: String,
}

#[derive(FromRow)]
struct AdminRow {
    id: Uuid,
    password_hash: String,
    email: String,
    display_name: String,
}

#[derive(Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
struct MeDto {
    email: String,
    display_name: String,
}

async fn login(
    State(st): State<AppState>,
    headers: HeaderMap,
    Json(input): Json<LoginInput>,
) -> Result<Response, AppError> {
    // Anti-brute-force: cap login attempts per client IP.
    st.rate.check(
        "admin-login",
        &crate::rate::client_ip(&headers),
        10,
        std::time::Duration::from_secs(300),
    )?;

    let admin = sqlx::query_as::<_, AdminRow>(
        "select id, password_hash, email, display_name from admin_user where email = $1",
    )
    .bind(input.email.trim().to_lowercase())
    .fetch_optional(&st.pool)
    .await?;

    let admin = match admin {
        Some(a) if verify_password(&a.password_hash, &input.password) => a,
        _ => {
            return Err(AppError::BadRequest(
                "E-mail ou mot de passe incorrect.".into(),
            ))
        }
    };

    let token = new_token();
    sqlx::query(
        "insert into admin_session (token, admin_user_id, expires_at) \
         values ($1, $2, now() + ($3 || ' days')::interval)",
    )
    .bind(&token)
    .bind(admin.id)
    .bind(SESSION_DAYS.to_string())
    .execute(&st.pool)
    .await?;

    let body = Json(MeDto {
        email: admin.email,
        display_name: admin.display_name,
    });
    let mut resp = body.into_response();
    resp.headers_mut().insert(
        header::SET_COOKIE,
        cookie_value(&token, SESSION_DAYS * 24 * 3600),
    );
    Ok(resp)
}

async fn logout(State(st): State<AppState>, req: Request) -> Result<Response, AppError> {
    if let Some(token) = req
        .headers()
        .get(header::COOKIE)
        .and_then(|v| v.to_str().ok())
        .and_then(session_cookie)
    {
        sqlx::query("delete from admin_session where token = $1")
            .bind(&token)
            .execute(&st.pool)
            .await?;
    }
    let mut resp = Json(serde_json::json!({ "ok": true })).into_response();
    resp.headers_mut()
        .insert(header::SET_COOKIE, cookie_value("", 0));
    Ok(resp)
}

fn cookie_value(token: &str, max_age: i64) -> axum::http::HeaderValue {
    // SameSite=Lax suffit : front et API partagent le site (localhost / domaine).
    // Secure ajouté en production (COOKIE_SECURE=true) — cf. crate::cookie_secure.
    let v = format!(
        "session={token}; HttpOnly; SameSite=Lax; Path=/; Max-Age={max_age}{}",
        crate::cookie_secure()
    );
    axum::http::HeaderValue::from_str(&v).expect("valid cookie header")
}

async fn me(
    State(st): State<AppState>,
    Extension(AdminId(id)): Extension<AdminId>,
) -> Result<Json<MeDto>, AppError> {
    let dto =
        sqlx::query_as::<_, MeDto>("select email, display_name from admin_user where id = $1")
            .bind(id)
            .fetch_one(&st.pool)
            .await?;
    Ok(Json(dto))
}

// ---------------------------------------------------------------------------
// Éditorial (propriété)
// ---------------------------------------------------------------------------

#[derive(Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
struct AdminPropertyDto {
    slug: String,
    name: String,
    location_label: String,
    description: String,
    surface_label: String,
    capacity: i32,
    bedrooms: i32,
    specs_label: String,
    highlight_label: String,
    hero_seed: String,
    deposit_pct: i32,
    caution_cents: i64,
    tourist_tax_cents: i64,
    arrival_instructions: String,
    house_rules: String,
}

async fn get_property(
    State(st): State<AppState>,
    Path(slug): Path<String>,
) -> Result<Json<AdminPropertyDto>, AppError> {
    let dto = sqlx::query_as::<_, AdminPropertyDto>(
        "select slug, name, location_label, description, surface_label, capacity, bedrooms, \
                specs_label, highlight_label, hero_seed, deposit_pct, caution_cents, \
                tourist_tax_cents, arrival_instructions, house_rules \
         from property where slug = $1",
    )
    .bind(&slug)
    .fetch_optional(&st.pool)
    .await?
    .ok_or_else(|| AppError::NotFound("propriété".into()))?;
    Ok(Json(dto))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateProperty {
    name: String,
    location_label: String,
    description: String,
    surface_label: String,
    capacity: i32,
    bedrooms: i32,
    specs_label: String,
    highlight_label: String,
    hero_seed: String,
    deposit_pct: i32,
    caution_cents: i64,
    #[serde(default)]
    tourist_tax_cents: i64,
    #[serde(default)]
    arrival_instructions: String,
    #[serde(default)]
    house_rules: String,
}

async fn update_property(
    State(st): State<AppState>,
    Path(slug): Path<String>,
    Json(p): Json<UpdateProperty>,
) -> Result<Json<AdminPropertyDto>, AppError> {
    if p.deposit_pct < 0 || p.deposit_pct > 100 {
        return Err(AppError::BadRequest("Acompte : 0 à 100 %.".into()));
    }
    if p.tourist_tax_cents < 0 {
        return Err(AppError::BadRequest("Taxe de séjour invalide.".into()));
    }
    let dto = sqlx::query_as::<_, AdminPropertyDto>(
        "update property set name=$2, location_label=$3, description=$4, surface_label=$5, \
                capacity=$6, bedrooms=$7, specs_label=$8, highlight_label=$9, hero_seed=$10, \
                deposit_pct=$11, caution_cents=$12, arrival_instructions=$13, house_rules=$14, \
                tourist_tax_cents=$15, updated_at=now() \
         where slug=$1 \
         returning slug, name, location_label, description, surface_label, capacity, bedrooms, \
                   specs_label, highlight_label, hero_seed, deposit_pct, caution_cents, \
                   tourist_tax_cents, arrival_instructions, house_rules",
    )
    .bind(&slug)
    .bind(&p.name)
    .bind(&p.location_label)
    .bind(&p.description)
    .bind(&p.surface_label)
    .bind(p.capacity)
    .bind(p.bedrooms)
    .bind(&p.specs_label)
    .bind(&p.highlight_label)
    .bind(&p.hero_seed)
    .bind(p.deposit_pct)
    .bind(p.caution_cents)
    .bind(&p.arrival_instructions)
    .bind(&p.house_rules)
    .bind(p.tourist_tax_cents)
    .fetch_optional(&st.pool)
    .await?
    .ok_or_else(|| AppError::NotFound("propriété".into()))?;
    Ok(Json(dto))
}

// ---------------------------------------------------------------------------
// Dispos & tarifs (semaines)
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct SlugQuery {
    slug: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct WeeksQuery {
    slug: String,
    #[serde(default)]
    season_id: Option<Uuid>,
}

#[derive(Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
struct AdminWeekDto {
    id: Uuid,
    start_date: NaiveDate,
    end_date: NaiveDate,
    range_label: String,
    sub_label: String,
    price_cents: i64,
    status: String,
    position: i32,
    season_id: Option<Uuid>,
    tier_key: Option<String>,
}

async fn list_weeks(
    State(st): State<AppState>,
    Query(q): Query<WeeksQuery>,
) -> Result<Json<Vec<AdminWeekDto>>, AppError> {
    let weeks = match q.season_id {
        Some(season_id) => {
            sqlx::query_as::<_, AdminWeekDto>(
                "select aw.id, aw.start_date, aw.end_date, aw.range_label, aw.sub_label, \
                        aw.price_cents, aw.status, aw.position, aw.season_id, aw.tier_key \
                 from availability_week aw \
                 where aw.season_id = $1 order by aw.start_date, aw.position",
            )
            .bind(season_id)
            .fetch_all(&st.pool)
            .await?
        }
        None => {
            sqlx::query_as::<_, AdminWeekDto>(
                "select aw.id, aw.start_date, aw.end_date, aw.range_label, aw.sub_label, \
                        aw.price_cents, aw.status, aw.position, aw.season_id, aw.tier_key \
                 from availability_week aw join property p on p.id = aw.property_id \
                 where p.slug = $1 order by aw.start_date, aw.position",
            )
            .bind(&q.slug)
            .fetch_all(&st.pool)
            .await?
        }
    };
    Ok(Json(weeks))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateWeek {
    price_cents: i64,
    status: String,
    sub_label: String,
    #[serde(default)]
    tier_key: Option<String>,
}

async fn update_week(
    State(st): State<AppState>,
    Path(id): Path<Uuid>,
    Json(w): Json<UpdateWeek>,
) -> Result<Json<AdminWeekDto>, AppError> {
    if !matches!(w.status.as_str(), "available" | "booked" | "blocked") {
        return Err(AppError::BadRequest("Statut de semaine invalide.".into()));
    }
    if w.price_cents < 0 {
        return Err(AppError::BadRequest("Prix négatif.".into()));
    }
    let dto = sqlx::query_as::<_, AdminWeekDto>(
        "update availability_week set price_cents=$2, status=$3, sub_label=$4, tier_key=$5 \
         where id=$1 \
         returning id, start_date, end_date, range_label, sub_label, price_cents, status, \
                   position, season_id, tier_key",
    )
    .bind(id)
    .bind(w.price_cents)
    .bind(&w.status)
    .bind(&w.sub_label)
    .bind(w.tier_key.as_deref())
    .fetch_optional(&st.pool)
    .await?
    .ok_or_else(|| AppError::NotFound("semaine".into()))?;
    Ok(Json(dto))
}

// ---------------------------------------------------------------------------
// Prestations (produits)
// ---------------------------------------------------------------------------

#[derive(Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
struct AdminProductDto {
    id: Uuid,
    key: String,
    label: String,
    description: String,
    price_cents: i64,
    active: bool,
    position: i32,
}

async fn list_products(State(st): State<AppState>) -> Result<Json<Vec<AdminProductDto>>, AppError> {
    let products = sqlx::query_as::<_, AdminProductDto>(
        "select id, key, label, description, price_cents, active, position \
         from product order by position, label",
    )
    .fetch_all(&st.pool)
    .await?;
    Ok(Json(products))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProductInput {
    key: String,
    label: String,
    description: String,
    price_cents: i64,
    active: bool,
    position: i32,
}

async fn create_product(
    State(st): State<AppState>,
    Json(p): Json<ProductInput>,
) -> Result<Json<AdminProductDto>, AppError> {
    if p.key.trim().is_empty() || p.label.trim().is_empty() {
        return Err(AppError::BadRequest("Clé et libellé requis.".into()));
    }
    let dto = sqlx::query_as::<_, AdminProductDto>(
        "insert into product (key, label, description, price_cents, active, position) \
         values ($1,$2,$3,$4,$5,$6) \
         returning id, key, label, description, price_cents, active, position",
    )
    .bind(p.key.trim())
    .bind(&p.label)
    .bind(&p.description)
    .bind(p.price_cents)
    .bind(p.active)
    .bind(p.position)
    .fetch_one(&st.pool)
    .await
    .map_err(unique_key_error)?;
    Ok(Json(dto))
}

async fn update_product(
    State(st): State<AppState>,
    Path(id): Path<Uuid>,
    Json(p): Json<ProductInput>,
) -> Result<Json<AdminProductDto>, AppError> {
    let dto = sqlx::query_as::<_, AdminProductDto>(
        "update product set key=$2, label=$3, description=$4, price_cents=$5, active=$6, position=$7 \
         where id=$1 \
         returning id, key, label, description, price_cents, active, position",
    )
    .bind(id)
    .bind(p.key.trim())
    .bind(&p.label)
    .bind(&p.description)
    .bind(p.price_cents)
    .bind(p.active)
    .bind(p.position)
    .fetch_optional(&st.pool)
    .await
    .map_err(unique_key_error)?
    .ok_or_else(|| AppError::NotFound("prestation".into()))?;
    Ok(Json(dto))
}

async fn delete_product(
    State(st): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, AppError> {
    let res = sqlx::query("delete from product where id = $1")
        .bind(id)
        .execute(&st.pool)
        .await
        .map_err(|e| match &e {
            sqlx::Error::Database(db) if db.is_foreign_key_violation() => AppError::BadRequest(
                "Prestation utilisée par des réservations : désactivez-la plutôt.".into(),
            ),
            _ => AppError::Db(e),
        })?;
    if res.rows_affected() == 0 {
        return Err(AppError::NotFound("prestation".into()));
    }
    Ok(StatusCode::NO_CONTENT)
}

fn unique_key_error(e: sqlx::Error) -> AppError {
    match &e {
        sqlx::Error::Database(db) if db.is_unique_violation() => {
            AppError::BadRequest("Cette clé de prestation existe déjà.".into())
        }
        _ => AppError::Db(e),
    }
}

// ---------------------------------------------------------------------------
// Réservations
// ---------------------------------------------------------------------------

#[derive(Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
struct AdminBookingDto {
    reference: String,
    status: String,
    week_range: String,
    total_cents: i64,
    deposit_cents: i64,
    balance_cents: i64,
    caution_cents: i64,
    deposit_paid_at: Option<DateTime<Utc>>,
    balance_paid_at: Option<DateTime<Utc>>,
    caution_authorized_at: Option<DateTime<Utc>>,
    caution_released_at: Option<DateTime<Utc>>,
    caution_captured_cents: Option<i64>,
    deposit_refunded_cents: i64,
    balance_refunded_cents: i64,
    balance_attempts: i32,
    balance_last_error: Option<String>,
    caution_attempts: i32,
    caution_last_error: Option<String>,
    /// Confirmed, balance still unpaid, and arrival is today or past → needs attention.
    balance_overdue: bool,
    /// Set by webhook events raised from the Stripe dashboard ('refunded_externally'
    /// or 'disputed'); the scheduler skips flagged bookings.
    payment_flag: Option<String>,
    contract_signed_at: Option<DateTime<Utc>>,
    contract_version: Option<String>,
    customer_email: Option<String>,
    customer_name: Option<String>,
    created_at: DateTime<Utc>,
}

async fn list_bookings(State(st): State<AppState>) -> Result<Json<Vec<AdminBookingDto>>, AppError> {
    let rows = sqlx::query_as::<_, AdminBookingDto>(
        "select b.reference, b.status, aw.range_label as week_range, \
                b.total_cents, b.deposit_cents, b.balance_cents, b.caution_cents, \
                b.deposit_paid_at, b.balance_paid_at, b.caution_authorized_at, \
                b.caution_released_at, b.caution_captured_cents, \
                coalesce((select sum(p.amount_cents) from payment p where p.booking_id = b.id \
                    and p.type = 'refund' and p.raw->>'source' = 'deposit'), 0)::bigint as deposit_refunded_cents, \
                coalesce((select sum(p.amount_cents) from payment p where p.booking_id = b.id \
                    and p.type = 'refund' and p.raw->>'source' = 'balance'), 0)::bigint as balance_refunded_cents, \
                b.balance_attempts, b.balance_last_error, b.caution_attempts, b.caution_last_error, \
                (b.status = 'confirmed' and b.balance_paid_at is null and b.balance_cents > 0 \
                    and aw.start_date <= current_date) as balance_overdue, \
                b.payment_flag, b.contract_accepted_at as contract_signed_at, b.contract_version, \
                c.email as customer_email, \
                nullif(trim(coalesce(c.first_name,'') || ' ' || coalesce(c.last_name,'')), '') as customer_name, \
                b.created_at \
         from booking b \
         join availability_week aw on aw.id = b.week_id \
         left join customer c on c.id = b.customer_id \
         order by b.created_at desc",
    )
    .fetch_all(&st.pool)
    .await?;
    Ok(Json(rows))
}

#[derive(Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
struct SignatureDto {
    signature_png: Option<String>,
    contract_version: Option<String>,
    signed_at: Option<DateTime<Utc>>,
}

/// Signature du contrat (preuve) pour une réservation.
async fn get_signature(
    State(st): State<AppState>,
    Path(reference): Path<String>,
) -> Result<Json<SignatureDto>, AppError> {
    let row = sqlx::query_as::<_, SignatureDto>(
        "select signature_png, contract_version, contract_accepted_at as signed_at \
         from booking where reference = $1",
    )
    .bind(&reference)
    .fetch_optional(&st.pool)
    .await?
    .ok_or_else(|| AppError::NotFound("réservation".into()))?;
    Ok(Json(row))
}

/// Déclenche un tick du planificateur à la demande (test / ops).
async fn run_scheduler(
    State(st): State<AppState>,
) -> Result<Json<crate::scheduler::TickReport>, AppError> {
    Ok(Json(
        crate::scheduler::run_tick(&st.pool, &st.payments).await,
    ))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CancelInput {
    #[serde(default)]
    reason: String,
    #[serde(default)]
    refund_deposit_cents: i64,
    #[serde(default)]
    refund_balance_cents: i64,
}

#[derive(FromRow)]
struct CancelRow {
    id: Uuid,
    status: String,
    deposit_cents: i64,
    balance_cents: i64,
    deposit_paid_at: Option<DateTime<Utc>>,
    balance_paid_at: Option<DateTime<Utc>>,
    caution_intent_id: Option<String>,
    caution_authorized_at: Option<DateTime<Utc>>,
    caution_released_at: Option<DateTime<Utc>>,
}

/// Annule une réservation confirmée. Règle : l'acompte reste acquis et le solde
/// n'est pas prélevé. L'admin peut toutefois rembourser tout ou partie des
/// sommes déjà réglées (acompte / solde). Un panier ne peut pas être annulé.
async fn cancel_booking(
    State(st): State<AppState>,
    Path(reference): Path<String>,
    Json(body): Json<CancelInput>,
) -> Result<StatusCode, AppError> {
    let b = sqlx::query_as::<_, CancelRow>(
        "select id, status, deposit_cents, balance_cents, deposit_paid_at, balance_paid_at, \
                caution_intent_id, caution_authorized_at, caution_released_at \
         from booking where reference = $1",
    )
    .bind(&reference)
    .fetch_optional(&st.pool)
    .await?
    .ok_or_else(|| AppError::NotFound("réservation".into()))?;

    if b.status == "cancelled" {
        return Ok(StatusCode::NO_CONTENT); // idempotent
    }
    if b.status == "cart" {
        return Err(AppError::BadRequest(
            "Un panier (paiement non finalisé) ne peut pas être annulé.".into(),
        ));
    }

    let deposit_paid = if b.deposit_paid_at.is_some() {
        b.deposit_cents
    } else {
        0
    };
    let balance_paid = if b.balance_paid_at.is_some() {
        b.balance_cents
    } else {
        0
    };
    if body.refund_deposit_cents < 0 || body.refund_deposit_cents > deposit_paid {
        return Err(AppError::BadRequest(
            "Remboursement d'acompte invalide (supérieur au montant réglé).".into(),
        ));
    }
    if body.refund_balance_cents < 0 || body.refund_balance_cents > balance_paid {
        return Err(AppError::BadRequest(
            "Remboursement de solde invalide (supérieur au montant réglé).".into(),
        ));
    }

    // 1) External side-effects first — all idempotent (stable Stripe keys), so a
    //    full retry after a mid-way failure never double-refunds/double-releases.
    let mut refunds = Vec::new();
    if body.refund_deposit_cents > 0 {
        refunds.push(perform_refund(&st, b.id, "deposit", body.refund_deposit_cents).await?);
    }
    if body.refund_balance_cents > 0 {
        refunds.push(perform_refund(&st, b.id, "balance", body.refund_balance_cents).await?);
    }
    // Release any active caution imprint — no reason to hold it on a cancellation.
    let release_intent = match (
        &b.caution_intent_id,
        b.caution_authorized_at,
        b.caution_released_at,
    ) {
        (Some(intent), Some(_), None) => {
            st.payments
                .release(intent, &format!("release-{}", b.id))
                .await?;
            Some(intent.clone())
        }
        _ => None,
    };

    // 2) Persist everything atomically: refunds, caution release, cancel, free week.
    let mut tx = st.pool.begin().await?;
    for rr in &refunds {
        insert_refund_row(&mut tx, b.id, st.payments.name(), rr).await?;
    }
    if let Some(intent) = &release_intent {
        sqlx::query(
            "update booking set caution_captured_cents = 0, caution_released_at = now() \
             where id = $1",
        )
        .bind(b.id)
        .execute(&mut *tx)
        .await?;
        sqlx::query(
            "insert into payment (booking_id, type, provider, provider_intent_id, amount_cents, status) \
             values ($1, 'caution_release', $2, $3, 0, 'released')",
        )
        .bind(b.id)
        .bind(st.payments.name())
        .bind(intent)
        .execute(&mut *tx)
        .await?;
    }
    sqlx::query(
        "update booking set status = 'cancelled', cancelled_at = now(), \
            cancel_reason = $2, updated_at = now() where id = $1",
    )
    .bind(b.id)
    .bind(&body.reason)
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        "update availability_week set status = 'available' \
         where id = (select week_id from booking where id = $1) and status = 'booked'",
    )
    .bind(b.id)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;

    // Confirm the cancellation to the customer, stating any refund made.
    let refunded: i64 = body.refund_deposit_cents + body.refund_balance_cents;
    if let Some((email, first_name, week_range)) =
        sqlx::query_as::<_, (Option<String>, Option<String>, String)>(
            "select c.email, c.first_name, aw.range_label \
         from booking b join availability_week aw on aw.id = b.week_id \
         left join customer c on c.id = b.customer_id where b.id = $1",
        )
        .bind(b.id)
        .fetch_optional(&st.pool)
        .await?
        .filter(|(e, _, _)| e.as_deref().map(|s| !s.is_empty()).unwrap_or(false))
    {
        let hello = match first_name
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
        {
            Some(n) => format!("Bonjour {n},"),
            None => "Bonjour,".to_string(),
        };
        let refund_line = if refunded > 0 {
            format!(
                "<br><br>Un remboursement de {},{:02} € a été effectué sur votre moyen de \
                 paiement (délai bancaire habituel : quelques jours).",
                refunded / 100,
                (refunded % 100).abs()
            )
        } else {
            String::new()
        };
        let body_html = format!(
            "{hello}<br><br>Votre réservation {reference} (semaine {week_range}) à L'Adret a bien \
             été annulée.{refund_line}<br><br>Pour toute question, répondez simplement à cet e-mail."
        );
        let html = crate::email::template("Réservation annulée", &body_html, "", "");
        crate::email::spawn(
            email.unwrap(),
            "Annulation de votre réservation — L'Adret".into(),
            html,
        );
    }

    Ok(StatusCode::NO_CONTENT)
}

// ---------------------------------------------------------------------------
// Caution (capture / libération) & remboursements — après état des lieux.
// ---------------------------------------------------------------------------

#[derive(FromRow)]
struct CautionRow {
    id: Uuid,
    caution_intent_id: Option<String>,
    caution_cents: i64,
    caution_authorized_at: Option<chrono::DateTime<chrono::Utc>>,
    caution_released_at: Option<chrono::DateTime<chrono::Utc>>,
}

async fn load_caution(st: &AppState, reference: &str) -> Result<CautionRow, AppError> {
    let b = sqlx::query_as::<_, CautionRow>(
        "select id, caution_intent_id, caution_cents, caution_authorized_at, caution_released_at \
         from booking where reference = $1",
    )
    .bind(reference)
    .fetch_optional(&st.pool)
    .await?
    .ok_or_else(|| AppError::NotFound("réservation".into()))?;
    if b.caution_intent_id.is_none() || b.caution_authorized_at.is_none() {
        return Err(AppError::BadRequest(
            "Aucune empreinte de caution active sur cette réservation.".into(),
        ));
    }
    if b.caution_released_at.is_some() {
        return Err(AppError::BadRequest("Caution déjà traitée.".into()));
    }
    Ok(b)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CaptureInput {
    amount_cents: i64,
}

async fn capture_caution(
    State(st): State<AppState>,
    Path(reference): Path<String>,
    Json(body): Json<CaptureInput>,
) -> Result<StatusCode, AppError> {
    let b = load_caution(&st, &reference).await?;
    if body.amount_cents <= 0 || body.amount_cents > b.caution_cents {
        return Err(AppError::BadRequest(
            "Montant à capturer invalide (0 < montant ≤ caution).".into(),
        ));
    }
    let intent = b.caution_intent_id.clone().unwrap();
    st.payments
        .capture(&intent, body.amount_cents, &format!("capture-{}", b.id))
        .await?;
    sqlx::query(
        "update booking set caution_captured_cents = $2, caution_released_at = now(), \
            updated_at = now() where id = $1",
    )
    .bind(b.id)
    .bind(body.amount_cents)
    .execute(&st.pool)
    .await?;
    sqlx::query(
        "insert into payment (booking_id, type, provider, provider_intent_id, amount_cents, status) \
         values ($1, 'caution_capture', $2, $3, $4, 'captured')",
    )
    .bind(b.id)
    .bind(st.payments.name())
    .bind(&intent)
    .bind(body.amount_cents)
    .execute(&st.pool)
    .await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn release_caution(
    State(st): State<AppState>,
    Path(reference): Path<String>,
) -> Result<StatusCode, AppError> {
    let b = load_caution(&st, &reference).await?;
    let intent = b.caution_intent_id.clone().unwrap();
    st.payments
        .release(&intent, &format!("release-{}", b.id))
        .await?;
    sqlx::query(
        "update booking set caution_captured_cents = 0, caution_released_at = now(), \
            updated_at = now() where id = $1",
    )
    .bind(b.id)
    .execute(&st.pool)
    .await?;
    sqlx::query(
        "insert into payment (booking_id, type, provider, provider_intent_id, amount_cents, status) \
         values ($1, 'caution_release', $2, $3, 0, 'released')",
    )
    .bind(b.id)
    .bind(st.payments.name())
    .bind(&intent)
    .execute(&st.pool)
    .await?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RefundInput {
    amount_cents: i64,
    #[serde(default)]
    payment_type: Option<String>,
}

/// A Stripe refund that succeeded but has not yet been recorded in the DB.
struct RefundRow {
    refund_id: String,
    amount_cents: i64,
    source: String,
}

/// Validate and execute the Stripe refund for `amount_cents` from the latest
/// succeeded payment of `ptype` (deposit/balance), capped at the net already-charged
/// amount (charged minus prior refunds of the same type). Returns the row to record
/// — the caller persists it, so the DB write can be batched into an atomic tx and a
/// full retry stays idempotent (the Stripe key is stable until a row is committed).
async fn perform_refund(
    st: &AppState,
    booking_id: Uuid,
    ptype: &str,
    amount_cents: i64,
) -> Result<RefundRow, AppError> {
    if amount_cents <= 0 {
        return Err(AppError::BadRequest(
            "Montant à rembourser invalide.".into(),
        ));
    }
    let src: Option<(String, i64)> = sqlx::query_as(
        "select provider_intent_id, amount_cents from payment \
         where booking_id = $1 and type = $2 and status = 'succeeded' \
           and provider_intent_id is not null order by created_at desc limit 1",
    )
    .bind(booking_id)
    .bind(ptype)
    .fetch_optional(&st.pool)
    .await?;
    let (intent, charged) = src
        .ok_or_else(|| AppError::BadRequest(format!("Aucun paiement « {ptype} » à rembourser.")))?;

    let already: i64 = sqlx::query_scalar(
        "select coalesce(sum(amount_cents), 0)::bigint from payment \
         where booking_id = $1 and type = 'refund' and raw->>'source' = $2",
    )
    .bind(booking_id)
    .bind(ptype)
    .fetch_one(&st.pool)
    .await?;

    let refundable = (charged - already).max(0);
    if amount_cents > refundable {
        return Err(AppError::BadRequest(format!(
            "Remboursement impossible : {:.2} € déjà remboursés sur {:.2} € prélevés (reste {:.2} €).",
            already as f64 / 100.0,
            charged as f64 / 100.0,
            refundable as f64 / 100.0,
        )));
    }

    // Key on the prior-refunds total: a retried (lost-response) refund reuses the
    // same key and replays; a genuinely new refund has a higher `already` → new key.
    let refund_id = st
        .payments
        .refund(
            &intent,
            amount_cents,
            &format!("refund-{booking_id}-{ptype}-{already}"),
        )
        .await?;
    Ok(RefundRow {
        refund_id,
        amount_cents,
        source: ptype.to_string(),
    })
}

/// Record a completed Stripe refund inside the caller's transaction.
async fn insert_refund_row(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    booking_id: Uuid,
    provider: &str,
    rr: &RefundRow,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "insert into payment (booking_id, type, provider, provider_intent_id, amount_cents, status, raw) \
         values ($1, 'refund', $2, $3, $4, 'refunded', jsonb_build_object('source', $5::text))",
    )
    .bind(booking_id)
    .bind(provider)
    .bind(&rr.refund_id)
    .bind(rr.amount_cents)
    .bind(&rr.source)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

async fn refund_payment(
    State(st): State<AppState>,
    Path(reference): Path<String>,
    Json(body): Json<RefundInput>,
) -> Result<StatusCode, AppError> {
    if body.amount_cents <= 0 {
        return Err(AppError::BadRequest(
            "Montant à rembourser invalide.".into(),
        ));
    }
    let ptype = body.payment_type.unwrap_or_else(|| "deposit".into());
    let bid: Uuid = sqlx::query_scalar("select id from booking where reference = $1")
        .bind(&reference)
        .fetch_optional(&st.pool)
        .await?
        .ok_or_else(|| AppError::NotFound("réservation".into()))?;
    let rr = perform_refund(&st, bid, &ptype, body.amount_cents).await?;
    let mut tx = st.pool.begin().await?;
    insert_refund_row(&mut tx, bid, st.payments.name(), &rr).await?;
    tx.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}

// ---------------------------------------------------------------------------
// Photos (property_media) — upload sur disque, servies sur /media.
// ---------------------------------------------------------------------------

#[derive(Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
struct AdminMediaDto {
    id: Uuid,
    url: String,
    alt: String,
    position: i32,
}

async fn list_media(
    State(st): State<AppState>,
    Path(slug): Path<String>,
) -> Result<Json<Vec<AdminMediaDto>>, AppError> {
    let media = sqlx::query_as::<_, AdminMediaDto>(
        "select pm.id, '/media/' || pm.filename as url, pm.alt, pm.position \
         from property_media pm join property p on p.id = pm.property_id \
         where p.slug = $1 order by pm.position, pm.created_at",
    )
    .bind(&slug)
    .fetch_all(&st.pool)
    .await?;
    Ok(Json(media))
}

async fn upload_media(
    State(st): State<AppState>,
    Path(slug): Path<String>,
    mut multipart: Multipart,
) -> Result<Json<AdminMediaDto>, AppError> {
    let prop_id: Uuid = sqlx::query_scalar("select id from property where slug = $1")
        .bind(&slug)
        .fetch_optional(&st.pool)
        .await?
        .ok_or_else(|| AppError::NotFound("propriété".into()))?;

    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|e| AppError::BadRequest(format!("Upload invalide : {e}")))?
    {
        if field.name() != Some("file") {
            continue;
        }
        let ext = match field.content_type() {
            Some("image/jpeg") => "jpg",
            Some("image/png") => "png",
            Some("image/webp") => "webp",
            _ => {
                return Err(AppError::BadRequest(
                    "Format accepté : JPEG, PNG ou WebP.".into(),
                ))
            }
        };
        let data = field
            .bytes()
            .await
            .map_err(|e| AppError::BadRequest(format!("Lecture du fichier : {e}")))?;
        if data.is_empty() {
            return Err(AppError::BadRequest("Fichier vide.".into()));
        }
        if data.len() > 10 * 1024 * 1024 {
            return Err(AppError::BadRequest(
                "Image trop lourde (max 10 Mo).".into(),
            ));
        }

        let filename = format!("{}.{}", Uuid::new_v4().simple(), ext);
        tokio::fs::write(st.media_dir.join(&filename), &data)
            .await
            .map_err(|e| AppError::Internal(format!("écriture fichier : {e}")))?;

        let pos: i32 = sqlx::query_scalar(
            "select coalesce(max(position), -1) + 1 from property_media where property_id = $1",
        )
        .bind(prop_id)
        .fetch_one(&st.pool)
        .await?;

        let dto = sqlx::query_as::<_, AdminMediaDto>(
            "insert into property_media (property_id, filename, position) values ($1, $2, $3) \
             returning id, '/media/' || filename as url, alt, position",
        )
        .bind(prop_id)
        .bind(&filename)
        .bind(pos)
        .fetch_one(&st.pool)
        .await?;
        return Ok(Json(dto));
    }
    Err(AppError::BadRequest("Aucun fichier reçu.".into()))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateMedia {
    alt: String,
    position: i32,
}

async fn update_media(
    State(st): State<AppState>,
    Path(id): Path<Uuid>,
    Json(m): Json<UpdateMedia>,
) -> Result<Json<AdminMediaDto>, AppError> {
    let dto = sqlx::query_as::<_, AdminMediaDto>(
        "update property_media set alt = $2, position = $3 where id = $1 \
         returning id, '/media/' || filename as url, alt, position",
    )
    .bind(id)
    .bind(&m.alt)
    .bind(m.position)
    .fetch_optional(&st.pool)
    .await?
    .ok_or_else(|| AppError::NotFound("photo".into()))?;
    Ok(Json(dto))
}

async fn delete_media(
    State(st): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, AppError> {
    let filename: Option<String> =
        sqlx::query_scalar("delete from property_media where id = $1 returning filename")
            .bind(id)
            .fetch_optional(&st.pool)
            .await?;
    match filename {
        Some(f) => {
            let _ = tokio::fs::remove_file(st.media_dir.join(f)).await;
            Ok(StatusCode::NO_CONTENT)
        }
        None => Err(AppError::NotFound("photo".into())),
    }
}

// ---------------------------------------------------------------------------
// Génération de semaines (samedi → samedi) + suppression
// ---------------------------------------------------------------------------

fn fr_month_abbr(m: u32) -> &'static str {
    [
        "jan", "fév", "mars", "avr", "mai", "juin", "juil", "août", "sept", "oct", "nov", "déc",
    ][(m - 1) as usize]
}

fn fr_month_full(m: u32) -> &'static str {
    [
        "janvier",
        "février",
        "mars",
        "avril",
        "mai",
        "juin",
        "juillet",
        "août",
        "septembre",
        "octobre",
        "novembre",
        "décembre",
    ][(m - 1) as usize]
}

fn range_label(start: NaiveDate, end: NaiveDate) -> String {
    if start.month() == end.month() {
        format!(
            "{:02} — {:02} {}",
            start.day(),
            end.day(),
            fr_month_abbr(end.month())
        )
    } else {
        format!(
            "{:02} {} — {:02} {}",
            start.day(),
            fr_month_abbr(start.month()),
            end.day(),
            fr_month_abbr(end.month())
        )
    }
}

fn arrival_full(d: NaiveDate) -> String {
    format!("samedi {} {}", d.day(), fr_month_full(d.month()))
}

fn short_label(d: NaiveDate) -> String {
    format!("sam. {} {}", d.day(), fr_month_abbr(d.month()))
}

fn balance_due_label(start: NaiveDate) -> String {
    // Balance charged two weeks before arrival (buffer to retry if it fails).
    let b = start - Duration::days(14);
    format!("{} {} {}", b.day(), fr_month_full(b.month()), b.year())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GenerateWeeks {
    season_id: Uuid,
    start_date: NaiveDate,
    end_date: NaiveDate,
    #[serde(default)]
    tier_key: Option<String>,
    #[serde(default)]
    price_cents: Option<i64>,
}

/// Find a rate tier (priceCents, label) by key in a season's rate_tiers JSON.
fn find_tier(tiers: &serde_json::Value, key: &str) -> Option<(i64, String)> {
    tiers.as_array()?.iter().find_map(|t| {
        if t.get("key")?.as_str()? == key {
            let price = t.get("priceCents")?.as_i64()?;
            let label = t.get("label")?.as_str()?.to_string();
            Some((price, label))
        } else {
            None
        }
    })
}

async fn generate_weeks(
    State(st): State<AppState>,
    Json(g): Json<GenerateWeeks>,
) -> Result<Json<Vec<AdminWeekDto>>, AppError> {
    if g.start_date.weekday() != Weekday::Sat || g.end_date.weekday() != Weekday::Sat {
        return Err(AppError::BadRequest(
            "Le premier et le dernier jour doivent être des samedis.".into(),
        ));
    }
    if g.end_date < g.start_date {
        return Err(AppError::BadRequest(
            "Le dernier samedi doit être après le premier.".into(),
        ));
    }
    let count = (g.end_date - g.start_date).num_weeks() + 1;
    if count > 52 {
        return Err(AppError::BadRequest(
            "Plage trop longue (max 52 semaines).".into(),
        ));
    }

    let season = sqlx::query_as::<_, (Uuid, serde_json::Value)>(
        "select property_id, rate_tiers from season where id = $1",
    )
    .bind(g.season_id)
    .fetch_optional(&st.pool)
    .await?
    .ok_or_else(|| AppError::NotFound("saison".into()))?;
    let prop_id = season.0;

    // Resolve price + label: from the chosen tier, else from a flat price.
    let (price_cents, sub_label) = match &g.tier_key {
        Some(key) => find_tier(&season.1, key)
            .ok_or_else(|| AppError::BadRequest("Palier tarifaire inconnu.".into()))?,
        None => (
            g.price_cents
                .ok_or_else(|| AppError::BadRequest("Prix ou palier requis.".into()))?,
            "Samedi → samedi".to_string(),
        ),
    };
    if price_cents < 0 {
        return Err(AppError::BadRequest("Prix négatif.".into()));
    }

    let max_pos: i32 = sqlx::query_scalar(
        "select coalesce(max(position), -1) from availability_week where property_id = $1",
    )
    .bind(prop_id)
    .fetch_one(&st.pool)
    .await?;

    let mut created = Vec::new();
    for i in 0..count {
        let start = g.start_date + Duration::weeks(i);
        let end = start + Duration::days(7);
        let pos = max_pos + 1 + i as i32;
        let row = sqlx::query_as::<_, AdminWeekDto>(
            "insert into availability_week \
                (property_id, season_id, tier_key, start_date, end_date, range_label, sub_label, \
                 price_cents, status, arrival_label, arrival_short, depart_short, \
                 balance_due_label, position) \
             values ($1,$2,$3,$4,$5,$6,$7,$8,'available',$9,$10,$11,$12,$13) \
             on conflict (property_id, start_date) do nothing \
             returning id, start_date, end_date, range_label, sub_label, price_cents, status, \
                       position, season_id, tier_key",
        )
        .bind(prop_id)
        .bind(g.season_id)
        .bind(g.tier_key.as_deref())
        .bind(start)
        .bind(end)
        .bind(range_label(start, end))
        .bind(&sub_label)
        .bind(price_cents)
        .bind(arrival_full(start))
        .bind(short_label(start))
        .bind(short_label(end))
        .bind(balance_due_label(start))
        .bind(pos)
        .fetch_optional(&st.pool)
        .await?;
        if let Some(r) = row {
            created.push(r);
        }
    }
    Ok(Json(created))
}

// ---------------------------------------------------------------------------
// Saisons
// ---------------------------------------------------------------------------

#[derive(Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
struct SeasonDto {
    id: Uuid,
    name: String,
    start_date: NaiveDate,
    end_date: NaiveDate,
    is_active: bool,
    rate_tiers: serde_json::Value,
    position: i32,
}

async fn list_seasons(
    State(st): State<AppState>,
    Query(q): Query<SlugQuery>,
) -> Result<Json<Vec<SeasonDto>>, AppError> {
    let seasons = sqlx::query_as::<_, SeasonDto>(
        "select s.id, s.name, s.start_date, s.end_date, s.is_active, s.rate_tiers, s.position \
         from season s join property p on p.id = s.property_id \
         where p.slug = $1 order by s.start_date desc, s.position",
    )
    .bind(&q.slug)
    .fetch_all(&st.pool)
    .await?;
    Ok(Json(seasons))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateSeason {
    slug: String,
    name: String,
    start_date: NaiveDate,
    end_date: NaiveDate,
    #[serde(default)]
    rate_tiers: serde_json::Value,
}

async fn create_season(
    State(st): State<AppState>,
    Json(s): Json<CreateSeason>,
) -> Result<Json<SeasonDto>, AppError> {
    if s.name.trim().is_empty() {
        return Err(AppError::BadRequest("Nom de saison requis.".into()));
    }
    if s.end_date < s.start_date {
        return Err(AppError::BadRequest("Fin avant le début.".into()));
    }
    let prop_id: Uuid = sqlx::query_scalar("select id from property where slug = $1")
        .bind(&s.slug)
        .fetch_optional(&st.pool)
        .await?
        .ok_or_else(|| AppError::NotFound("propriété".into()))?;

    let tiers = if s.rate_tiers.is_null() {
        serde_json::json!([])
    } else {
        s.rate_tiers
    };

    let dto = sqlx::query_as::<_, SeasonDto>(
        "insert into season (property_id, name, start_date, end_date, rate_tiers) \
         values ($1,$2,$3,$4,$5) \
         returning id, name, start_date, end_date, is_active, rate_tiers, position",
    )
    .bind(prop_id)
    .bind(s.name.trim())
    .bind(s.start_date)
    .bind(s.end_date)
    .bind(&tiers)
    .fetch_one(&st.pool)
    .await?;
    Ok(Json(dto))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateSeason {
    name: String,
    start_date: NaiveDate,
    end_date: NaiveDate,
    is_active: bool,
    #[serde(default)]
    rate_tiers: serde_json::Value,
}

async fn update_season(
    State(st): State<AppState>,
    Path(id): Path<Uuid>,
    Json(s): Json<UpdateSeason>,
) -> Result<Json<SeasonDto>, AppError> {
    if s.end_date < s.start_date {
        return Err(AppError::BadRequest("Fin avant le début.".into()));
    }
    let tiers = if s.rate_tiers.is_null() {
        serde_json::json!([])
    } else {
        s.rate_tiers
    };

    let mut tx = st.pool.begin().await?;

    // Only one active season per property.
    if s.is_active {
        sqlx::query(
            "update season set is_active = false \
             where property_id = (select property_id from season where id = $1) and id <> $1",
        )
        .bind(id)
        .execute(&mut *tx)
        .await?;
    }

    let dto = sqlx::query_as::<_, SeasonDto>(
        "update season set name=$2, start_date=$3, end_date=$4, is_active=$5, rate_tiers=$6 \
         where id=$1 \
         returning id, name, start_date, end_date, is_active, rate_tiers, position",
    )
    .bind(id)
    .bind(s.name.trim())
    .bind(s.start_date)
    .bind(s.end_date)
    .bind(s.is_active)
    .bind(&tiers)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::NotFound("saison".into()))?;

    tx.commit().await?;
    Ok(Json(dto))
}

async fn delete_season(
    State(st): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, AppError> {
    let res = sqlx::query("delete from season where id = $1")
        .bind(id)
        .execute(&st.pool)
        .await?;
    if res.rows_affected() == 0 {
        return Err(AppError::NotFound("saison".into()));
    }
    Ok(StatusCode::NO_CONTENT)
}

async fn delete_week(
    State(st): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, AppError> {
    let res = sqlx::query("delete from availability_week where id = $1")
        .bind(id)
        .execute(&st.pool)
        .await
        .map_err(|e| match &e {
            sqlx::Error::Database(db) if db.is_foreign_key_violation() => AppError::BadRequest(
                "Semaine liée à une réservation : suppression impossible.".into(),
            ),
            _ => AppError::Db(e),
        })?;
    if res.rows_affected() == 0 {
        return Err(AppError::NotFound("semaine".into()));
    }
    Ok(StatusCode::NO_CONTENT)
}
