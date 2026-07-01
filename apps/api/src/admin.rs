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
        .route("/bookings/manual", post(create_manual_booking))
        .route("/finances", get(finances))
        .route("/contacts", get(list_contacts))
        .route("/bookings/:reference/signature", get(get_signature))
        .route("/bookings/:reference/mark-paid", post(mark_paid))
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
    // Sanitize the rich-text description server-side: it is rendered on the public
    // site via dangerouslySetInnerHTML, so a compromised admin session must not be
    // able to inject executable HTML/JS. ammonia keeps the safe Tiptap subset.
    let clean_description = ammonia::clean(&p.description);
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
    .bind(&clean_description)
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
    caution_released_at: Option<DateTime<Utc>>,
    caution_captured_cents: Option<i64>,
    channel: String,
    payment_method: Option<String>,
    caution_method: Option<String>,
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
                b.deposit_paid_at, b.balance_paid_at, \
                b.caution_released_at, b.caution_captured_cents, \
                b.channel, b.payment_method, b.caution_method, \
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

// ---------------------------------------------------------------------------
// Finances : flux consolidés (encaissé) + à venir + taxe de séjour (déclaration)
// ---------------------------------------------------------------------------

#[derive(FromRow)]
struct PaymentAgg {
    deposits_paid_cents: i64,
    balances_paid_cents: i64,
    refunds_cents: i64,
    caution_captured_cents: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FinanceSummary {
    deposits_paid_cents: i64,
    balances_paid_cents: i64,
    refunds_cents: i64,
    caution_captured_cents: i64,
    /// Encaissement net = acomptes + soldes + cautions capturées − remboursements.
    net_collected_cents: i64,
    /// Taxe de séjour déjà collectée (soldes réglés) — à reverser à la commune.
    tourist_tax_collected_cents: i64,
    /// Soldes à venir (réservations confirmées non encore soldées, taxe incluse).
    upcoming_balances_cents: i64,
    upcoming_count: i64,
    /// Taxe de séjour à venir (portée par les soldes non encore prélevés).
    tourist_tax_upcoming_cents: i64,
}

#[derive(Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
struct TaxDeclarationRow {
    reference: String,
    customer_name: Option<String>,
    start_date: NaiveDate,
    adults: i32,
    nights: i32,
    tourist_tax_cents: i64,
    collected: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FinancesResponse {
    summary: FinanceSummary,
    tax_declaration: Vec<TaxDeclarationRow>,
}

// ---------------------------------------------------------------------------
// Réservations manuelles (hors ligne) : échéances chèque/virement pointées à la
// main, caution par chèque. Ignorées par le scheduler (channel='manual').
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ManualCustomer {
    #[serde(default)]
    first_name: String,
    #[serde(default)]
    last_name: String,
    email: String,
    #[serde(default)]
    phone: String,
    #[serde(default)]
    address_line: String,
    #[serde(default)]
    postal_code: String,
    #[serde(default)]
    city: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ManualBookingInput {
    week_id: Uuid,
    customer: ManualCustomer,
    #[serde(default = "two")]
    adults: i32,
    #[serde(default)]
    children: i32,
    /// 'cheque' | 'virement' — moyen de règlement des échéances.
    payment_method: String,
    /// 'cheque' | 'card' — nature de la caution.
    caution_method: String,
    #[serde(default)]
    deposit_paid: bool,
    #[serde(default)]
    balance_paid: bool,
    #[serde(default)]
    admin_notes: String,
}

fn two() -> i32 {
    2
}

#[derive(FromRow)]
struct ManualPropRow {
    id: Uuid,
    deposit_pct: i32,
    caution_cents: i64,
    tourist_tax_cents: i64,
}

#[derive(FromRow)]
struct ManualWeekRow {
    price_cents: i64,
    status: String,
    range_label: String,
}

async fn create_manual_booking(
    State(st): State<AppState>,
    Json(input): Json<ManualBookingInput>,
) -> Result<Json<serde_json::Value>, AppError> {
    if !["cheque", "virement"].contains(&input.payment_method.as_str()) {
        return Err(AppError::BadRequest(
            "Moyen de règlement invalide (chèque ou virement).".into(),
        ));
    }
    if !["cheque", "card"].contains(&input.caution_method.as_str()) {
        return Err(AppError::BadRequest("Type de caution invalide.".into()));
    }
    if input.customer.email.trim().is_empty() {
        return Err(AppError::BadRequest("E-mail client requis.".into()));
    }

    let week = sqlx::query_as::<_, ManualWeekRow>(
        "select price_cents, status, range_label from availability_week where id = $1",
    )
    .bind(input.week_id)
    .fetch_optional(&st.pool)
    .await?
    .ok_or_else(|| AppError::NotFound("semaine".into()))?;
    if week.status != "available" {
        return Err(AppError::BadRequest(
            "Cette semaine n'est pas disponible.".into(),
        ));
    }
    let prop = sqlx::query_as::<_, ManualPropRow>(
        "select p.id, p.deposit_pct, p.caution_cents, p.tourist_tax_cents \
         from property p join availability_week aw on aw.property_id = p.id where aw.id = $1",
    )
    .bind(input.week_id)
    .fetch_one(&st.pool)
    .await?;

    let totals = crate::pricing::compute(
        week.price_cents,
        &[],
        prop.deposit_pct as i64,
        prop.tourist_tax_cents,
        input.adults.max(0) as i64,
        crate::pricing::NIGHTS_PER_WEEK,
    );
    let reference = format!(
        "ADR-{}",
        &Uuid::new_v4().simple().to_string()[..6].to_uppercase()
    );

    let mut tx = st.pool.begin().await?;
    // Claim the week atomically (available -> booked).
    let claimed = sqlx::query(
        "update availability_week set status = 'booked' where id = $1 and status = 'available'",
    )
    .bind(input.week_id)
    .execute(&mut *tx)
    .await?;
    if claimed.rows_affected() == 0 {
        return Err(AppError::BadRequest(
            "Cette semaine vient d'être réservée.".into(),
        ));
    }

    let c = &input.customer;
    let customer_id: Uuid = sqlx::query_as::<_, (Uuid,)>(
        "insert into customer \
            (email, first_name, last_name, phone, address_line, postal_code, city, country) \
         values ($1, $2, $3, $4, $5, $6, $7, 'France') \
         on conflict (lower(email)) where coalesce(email, '') <> '' \
         do update set first_name = excluded.first_name, last_name = excluded.last_name, \
            phone = excluded.phone, address_line = excluded.address_line, \
            postal_code = excluded.postal_code, city = excluded.city \
         returning id",
    )
    .bind(&c.email)
    .bind(&c.first_name)
    .bind(&c.last_name)
    .bind(&c.phone)
    .bind(&c.address_line)
    .bind(&c.postal_code)
    .bind(&c.city)
    .fetch_one(&mut *tx)
    .await?
    .0;

    let booking_id: Uuid = sqlx::query_as::<_, (Uuid,)>(
        "insert into booking \
            (reference, property_id, customer_id, week_id, status, channel, adults, children, \
             week_price_cents, extras_total_cents, total_cents, deposit_pct, deposit_cents, \
             balance_cents, caution_cents, tourist_tax_cents, payment_method, caution_method, \
             admin_notes, deposit_paid_at, balance_paid_at) \
         values ($1,$2,$3,$4,'confirmed','manual',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17, \
             case when $18 then now() end, case when $19 then now() end) returning id",
    )
    .bind(&reference)
    .bind(prop.id)
    .bind(customer_id)
    .bind(input.week_id)
    .bind(input.adults)
    .bind(input.children)
    .bind(totals.week_price_cents)
    .bind(totals.extras_total_cents)
    .bind(totals.total_cents)
    .bind(prop.deposit_pct)
    .bind(totals.deposit_cents)
    .bind(totals.balance_cents)
    .bind(prop.caution_cents)
    .bind(totals.tourist_tax_cents)
    .bind(&input.payment_method)
    .bind(&input.caution_method)
    .bind(&input.admin_notes)
    .bind(input.deposit_paid)
    .bind(input.balance_paid)
    .fetch_one(&mut *tx)
    .await?
    .0;

    sqlx::query(
        "insert into booking_line \
            (booking_id, kind, label, quantity, unit_price_cents, total_cents, position) \
         values ($1, 'accommodation', $2, 1, $3, $3, 0)",
    )
    .bind(booking_id)
    .bind(format!("Location · {}", week.range_label))
    .bind(week.price_cents)
    .execute(&mut *tx)
    .await?;

    if input.deposit_paid {
        insert_manual_payment(
            &mut tx,
            booking_id,
            "deposit",
            totals.deposit_cents,
            &input.payment_method,
        )
        .await?;
    }
    if input.balance_paid {
        insert_manual_payment(
            &mut tx,
            booking_id,
            "balance",
            totals.balance_cents,
            &input.payment_method,
        )
        .await?;
    }
    tx.commit().await?;

    Ok(Json(serde_json::json!({ "reference": reference })))
}

async fn insert_manual_payment(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    booking_id: Uuid,
    kind: &str,
    amount_cents: i64,
    method: &str,
) -> Result<(), AppError> {
    sqlx::query(
        "insert into payment (booking_id, type, provider, amount_cents, status, method) \
         values ($1, $2, 'manual', $3, 'succeeded', $4)",
    )
    .bind(booking_id)
    .bind(kind)
    .bind(amount_cents)
    .bind(method)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MarkPaidInput {
    /// 'deposit' | 'balance'
    kind: String,
    /// 'cheque' | 'virement'
    method: String,
}

/// Point manuellement une échéance (chèque/virement reçu) d'une réservation.
async fn mark_paid(
    State(st): State<AppState>,
    Path(reference): Path<String>,
    Json(body): Json<MarkPaidInput>,
) -> Result<StatusCode, AppError> {
    if !["deposit", "balance"].contains(&body.kind.as_str()) {
        return Err(AppError::BadRequest("Échéance invalide.".into()));
    }
    if !["cheque", "virement"].contains(&body.method.as_str()) {
        return Err(AppError::BadRequest("Moyen de règlement invalide.".into()));
    }
    let paid_col = if body.kind == "deposit" {
        "deposit_paid_at"
    } else {
        "balance_paid_at"
    };
    let amount_col = if body.kind == "deposit" {
        "deposit_cents"
    } else {
        "balance_cents"
    };
    let row = sqlx::query_as::<_, (Uuid, i64, bool)>(&format!(
        "select id, {amount_col}, ({paid_col} is not null) from booking \
         where reference = $1 and channel = 'manual'"
    ))
    .bind(&reference)
    .fetch_optional(&st.pool)
    .await?
    .ok_or_else(|| AppError::NotFound("réservation manuelle".into()))?;
    if row.2 {
        return Err(AppError::BadRequest("Échéance déjà pointée.".into()));
    }

    let mut tx = st.pool.begin().await?;
    let new_status = if body.kind == "balance" {
        "balance_paid"
    } else {
        "confirmed"
    };
    sqlx::query(&format!(
        "update booking set {paid_col} = now(), status = $2, updated_at = now() where id = $1"
    ))
    .bind(row.0)
    .bind(new_status)
    .execute(&mut *tx)
    .await?;
    insert_manual_payment(&mut tx, row.0, &body.kind, row.1, &body.method).await?;
    tx.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn finances(State(st): State<AppState>) -> Result<Json<FinancesResponse>, AppError> {
    let agg = sqlx::query_as::<_, PaymentAgg>(
        "select \
            coalesce(sum(amount_cents) filter (where type='deposit' and status='succeeded'),0)::bigint as deposits_paid_cents, \
            coalesce(sum(amount_cents) filter (where type='balance' and status='succeeded'),0)::bigint as balances_paid_cents, \
            coalesce(sum(amount_cents) filter (where type='refund'),0)::bigint as refunds_cents, \
            coalesce(sum(amount_cents) filter (where type='caution_capture' and status='captured'),0)::bigint as caution_captured_cents \
         from payment",
    )
    .fetch_one(&st.pool)
    .await?;

    let tax_collected: i64 = sqlx::query_scalar(
        "select coalesce(sum(tourist_tax_cents),0)::bigint from booking \
         where balance_paid_at is not null and status <> 'cancelled'",
    )
    .fetch_one(&st.pool)
    .await?;

    let (upcoming_balances, upcoming_count, tax_upcoming): (i64, i64, i64) = sqlx::query_as(
        "select coalesce(sum(balance_cents),0)::bigint, count(*)::bigint, \
                    coalesce(sum(tourist_tax_cents),0)::bigint \
             from booking where status = 'confirmed' and balance_paid_at is null",
    )
    .fetch_one(&st.pool)
    .await?;

    let net = agg.deposits_paid_cents + agg.balances_paid_cents + agg.caution_captured_cents
        - agg.refunds_cents;

    let tax_declaration = sqlx::query_as::<_, TaxDeclarationRow>(
        "select b.reference, \
                nullif(trim(coalesce(c.first_name,'') || ' ' || coalesce(c.last_name,'')), '') as customer_name, \
                aw.start_date, b.adults, 7 as nights, b.tourist_tax_cents, \
                (b.balance_paid_at is not null) as collected \
         from booking b \
         join availability_week aw on aw.id = b.week_id \
         left join customer c on c.id = b.customer_id \
         where b.tourist_tax_cents > 0 and b.status <> 'cancelled' \
         order by aw.start_date",
    )
    .fetch_all(&st.pool)
    .await?;

    Ok(Json(FinancesResponse {
        summary: FinanceSummary {
            deposits_paid_cents: agg.deposits_paid_cents,
            balances_paid_cents: agg.balances_paid_cents,
            refunds_cents: agg.refunds_cents,
            caution_captured_cents: agg.caution_captured_cents,
            net_collected_cents: net,
            tourist_tax_collected_cents: tax_collected,
            upcoming_balances_cents: upcoming_balances,
            upcoming_count,
            tourist_tax_upcoming_cents: tax_upcoming,
        },
        tax_declaration,
    }))
}

// ---------------------------------------------------------------------------
// CRM : contacts (clients ayant réservé + prospects restés au panier)
// ---------------------------------------------------------------------------

#[derive(Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
struct ContactDto {
    id: Uuid,
    email: String,
    name: Option<String>,
    phone: String,
    city: String,
    /// Nombre total de réservations (tous statuts).
    bookings_count: i64,
    /// Réservations confirmées ou soldées.
    confirmed_count: i64,
    /// Paniers en cours / abandonnés (prospect).
    cart_count: i64,
    total_paid_cents: i64,
    last_activity: DateTime<Utc>,
    created_at: DateTime<Utc>,
}

/// Tous les contacts (clients + prospects), avec agrégats et dernière activité.
async fn list_contacts(State(st): State<AppState>) -> Result<Json<Vec<ContactDto>>, AppError> {
    let rows = sqlx::query_as::<_, ContactDto>(
        "select c.id, c.email, \
                nullif(trim(coalesce(c.first_name,'') || ' ' || coalesce(c.last_name,'')), '') as name, \
                c.phone, c.city, \
                count(b.id) as bookings_count, \
                count(b.id) filter (where b.status in ('confirmed','balance_paid')) as confirmed_count, \
                count(b.id) filter (where b.status in ('cart','expired')) as cart_count, \
                (coalesce(sum(b.deposit_cents) filter (where b.deposit_paid_at is not null),0) \
                 + coalesce(sum(b.balance_cents) filter (where b.balance_paid_at is not null),0))::bigint as total_paid_cents, \
                coalesce(max(b.updated_at), c.created_at) as last_activity, \
                c.created_at \
         from customer c \
         left join booking b on b.customer_id = c.id \
         group by c.id \
         order by last_activity desc",
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
        "select id, status, deposit_cents, balance_cents, deposit_paid_at, balance_paid_at \
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
    // Caution = card-on-file (Option B) : nothing is held, so nothing to release on
    // cancellation — we simply never charge it.

    // 2) Persist everything atomically: refunds, cancel, free week.
    let mut tx = st.pool.begin().await?;
    for rr in &refunds {
        insert_refund_row(&mut tx, b.id, st.payments.name(), rr).await?;
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
    caution_cents: i64,
    provider_customer_id: Option<String>,
    provider_payment_method_id: Option<String>,
    caution_method: Option<String>,
    caution_released_at: Option<chrono::DateTime<chrono::Utc>>,
}

/// Caution model = card-on-file + charge-on-demand (Option B) : no Stripe hold is
/// placed. The card saved at the deposit is charged only if damage is found. The
/// caution is "settled" (caution_released_at) once the operator charges or waives it.
async fn load_caution(st: &AppState, reference: &str) -> Result<CautionRow, AppError> {
    let b = sqlx::query_as::<_, CautionRow>(
        "select id, caution_cents, provider_customer_id, provider_payment_method_id, \
                caution_method, caution_released_at \
         from booking where reference = $1",
    )
    .bind(reference)
    .fetch_optional(&st.pool)
    .await?
    .ok_or_else(|| AppError::NotFound("réservation".into()))?;
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

/// Charge damages on the saved card (off-session), up to the caution amount.
async fn capture_caution(
    State(st): State<AppState>,
    Path(reference): Path<String>,
    Json(body): Json<CaptureInput>,
) -> Result<StatusCode, AppError> {
    let b = load_caution(&st, &reference).await?;
    if body.amount_cents <= 0 || body.amount_cents > b.caution_cents {
        return Err(AppError::BadRequest(
            "Montant à débiter invalide (0 < montant ≤ caution).".into(),
        ));
    }

    // Cheque caution (manual bookings) or missing card → record the encashment
    // without any Stripe call. Card-on-file → charge off-session.
    let is_cheque = b.caution_method.as_deref() == Some("cheque");
    let (intent, provider, method): (Option<String>, &str, Option<&str>) = if is_cheque {
        (None, "manual", Some("cheque"))
    } else {
        let (Some(customer), Some(pm)) = (&b.provider_customer_id, &b.provider_payment_method_id)
        else {
            return Err(AppError::BadRequest(
                "Aucune carte enregistrée pour débiter la caution.".into(),
            ));
        };
        let id = st
            .payments
            .charge_off_session(
                customer,
                pm,
                body.amount_cents,
                &format!("caution-charge-{}", b.id),
            )
            .await?;
        (Some(id), st.payments.name(), None)
    };

    sqlx::query(
        "update booking set caution_captured_cents = $2, caution_released_at = now(), \
            updated_at = now() where id = $1",
    )
    .bind(b.id)
    .bind(body.amount_cents)
    .execute(&st.pool)
    .await?;
    sqlx::query(
        "insert into payment (booking_id, type, provider, provider_intent_id, amount_cents, status, method) \
         values ($1, 'caution_capture', $2, $3, $4, 'captured', $5)",
    )
    .bind(b.id)
    .bind(provider)
    .bind(&intent)
    .bind(body.amount_cents)
    .bind(method)
    .execute(&st.pool)
    .await?;
    Ok(StatusCode::NO_CONTENT)
}

/// Close the caution without charging (no damage). No Stripe call — nothing held.
async fn release_caution(
    State(st): State<AppState>,
    Path(reference): Path<String>,
) -> Result<StatusCode, AppError> {
    let b = load_caution(&st, &reference).await?;
    sqlx::query(
        "update booking set caution_captured_cents = 0, caution_released_at = now(), \
            updated_at = now() where id = $1",
    )
    .bind(b.id)
    .execute(&st.pool)
    .await?;
    sqlx::query(
        "insert into payment (booking_id, type, provider, provider_intent_id, amount_cents, status) \
         values ($1, 'caution_release', $2, null, 0, 'released')",
    )
    .bind(b.id)
    .bind(st.payments.name())
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
