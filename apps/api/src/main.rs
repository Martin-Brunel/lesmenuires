mod admin;
mod email;
mod error;
mod payments;
mod pricing;
mod scheduler;

use axum::{
    body::Bytes,
    extract::{Path, Query, State},
    http::{header, HeaderMap, HeaderValue, Method, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use chrono::{DateTime, NaiveDate, Utc};
use error::AppError;
use serde::{Deserialize, Serialize};
use sqlx::postgres::{PgPool, PgPoolOptions};
use sqlx::FromRow;
use std::env;
use tower_http::cors::CorsLayer;
use tower_http::trace::TraceLayer;
use uuid::Uuid;

#[derive(Clone)]
pub(crate) struct AppState {
    pub(crate) pool: PgPool,
    pub(crate) media_dir: std::sync::Arc<std::path::PathBuf>,
    pub(crate) payments: std::sync::Arc<dyn payments::PaymentProvider>,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    dotenvy::dotenv().ok();
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info,sqlx=warn".into()),
        )
        .init();

    let database_url = env::var("DATABASE_URL").expect("DATABASE_URL must be set");
    let bind = env::var("BIND_ADDR").unwrap_or_else(|_| "0.0.0.0:8080".into());

    let pool = PgPoolOptions::new()
        .max_connections(5)
        .connect(&database_url)
        .await?;

    sqlx::migrate!("./migrations").run(&pool).await?;

    seed_admin(&pool).await?;

    // Credentialed CORS: the back-office sends its session cookie cross-origin,
    // so the origin must be explicit (no wildcard) and credentials allowed.
    let front_origin = env::var("FRONT_ORIGIN").unwrap_or_else(|_| "http://localhost:3000".into());
    let cors = CorsLayer::new()
        .allow_origin(
            front_origin
                .parse::<HeaderValue>()
                .expect("valid FRONT_ORIGIN"),
        )
        .allow_credentials(true)
        .allow_methods([
            Method::GET,
            Method::POST,
            Method::PUT,
            Method::DELETE,
            Method::OPTIONS,
        ])
        .allow_headers([header::CONTENT_TYPE]);

    let media_dir =
        std::path::PathBuf::from(env::var("MEDIA_DIR").unwrap_or_else(|_| "./media".into()));
    tokio::fs::create_dir_all(&media_dir).await?;

    let state = AppState {
        pool,
        media_dir: std::sync::Arc::new(media_dir.clone()),
        payments: payments::from_env(),
    };

    let scheduler_interval = env::var("SCHEDULER_INTERVAL_SECS")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(300);
    scheduler::spawn(
        state.pool.clone(),
        state.payments.clone(),
        scheduler_interval,
    );

    let app = Router::new()
        .route("/api/health", get(health))
        .route("/api/booking-context/:slug", get(booking_context))
        .route("/api/bookings", post(create_booking))
        .route("/api/bookings/:reference", get(get_booking))
        .route("/api/me", get(customer_me))
        .route("/api/espace/request-link", post(request_link))
        .route("/api/espace/login", get(espace_login))
        .route("/api/espace/logout", post(espace_logout))
        .route("/api/bookings/:reference/pay-deposit", post(pay_deposit))
        .route(
            "/api/bookings/:reference/confirm-deposit",
            post(confirm_deposit),
        )
        .route("/api/payments/webhook", post(stripe_webhook))
        .with_state(state.clone())
        .nest("/api/admin", admin::routes(state.clone()))
        // Serve uploaded photos.
        .nest_service("/media", tower_http::services::ServeDir::new(media_dir))
        .layer(cors)
        .layer(TraceLayer::new_for_http());

    let listener = tokio::net::TcpListener::bind(&bind).await?;
    tracing::info!("API listening on http://{bind}");
    axum::serve(listener, app).await?;
    Ok(())
}

async fn health() -> Json<serde_json::Value> {
    Json(serde_json::json!({ "status": "ok" }))
}

// ----------------------------------------------------------------------------
// Booking context: everything the funnel needs in a single call.
// ----------------------------------------------------------------------------

#[derive(FromRow, Serialize)]
#[serde(rename_all = "camelCase")]
struct PropertyDto {
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
}

#[derive(FromRow, Serialize)]
#[serde(rename_all = "camelCase")]
struct WeekDto {
    id: Uuid,
    start_date: NaiveDate,
    range: String,
    sub: String,
    price_cents: i64,
    status: String,
    booked: bool,
    arrival: String,
    arr_short: String,
    dep_short: String,
    balance_due: String,
}

#[derive(FromRow, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProductDto {
    key: String,
    label: String,
    description: String,
    price_cents: i64,
}

#[derive(FromRow, Serialize)]
#[serde(rename_all = "camelCase")]
struct PublicMediaDto {
    url: String,
    alt: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PublicSeason {
    name: String,
    start_date: NaiveDate,
    end_date: NaiveDate,
}

#[derive(FromRow)]
struct ActiveSeasonRow {
    id: Uuid,
    name: String,
    start_date: NaiveDate,
    end_date: NaiveDate,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BookingContext {
    property: PropertyDto,
    season: Option<PublicSeason>,
    weeks: Vec<WeekDto>,
    products: Vec<ProductDto>,
    media: Vec<PublicMediaDto>,
}

async fn booking_context(
    State(st): State<AppState>,
    Path(slug): Path<String>,
) -> Result<Json<BookingContext>, AppError> {
    let property = sqlx::query_as::<_, PropertyDto>(
        "select slug, name, location_label, description, surface_label, capacity, bedrooms, \
                specs_label, highlight_label, hero_seed, deposit_pct, caution_cents \
         from property where slug = $1",
    )
    .bind(&slug)
    .fetch_optional(&st.pool)
    .await?
    .ok_or_else(|| AppError::NotFound("propriété".into()))?;

    // Public site shows only the active season's weeks.
    let active = sqlx::query_as::<_, ActiveSeasonRow>(
        "select s.id, s.name, s.start_date, s.end_date \
         from season s join property p on p.id = s.property_id \
         where p.slug = $1 and s.is_active order by s.start_date limit 1",
    )
    .bind(&slug)
    .fetch_optional(&st.pool)
    .await?;

    let weeks =
        match &active {
            Some(a) => sqlx::query_as::<_, WeekDto>(
                "select aw.id, aw.start_date, aw.range_label as \"range\", aw.sub_label as sub, \
                        aw.price_cents, aw.status, (aw.status = 'booked') as booked, \
                        aw.arrival_label as arrival, aw.arrival_short as arr_short, \
                        aw.depart_short as dep_short, aw.balance_due_label as balance_due \
                 from availability_week aw \
                 where aw.season_id = $1 and aw.status <> 'blocked' \
                 order by aw.start_date, aw.position",
            )
            .bind(a.id)
            .fetch_all(&st.pool)
            .await?,
            None => Vec::new(),
        };

    let season = active.map(|a| PublicSeason {
        name: a.name,
        start_date: a.start_date,
        end_date: a.end_date,
    });

    let products = sqlx::query_as::<_, ProductDto>(
        "select key, label, description, price_cents from product where active order by position",
    )
    .fetch_all(&st.pool)
    .await?;

    let media = sqlx::query_as::<_, PublicMediaDto>(
        "select '/media/' || pm.filename as url, pm.alt \
         from property_media pm join property p on p.id = pm.property_id \
         where p.slug = $1 order by pm.position, pm.created_at",
    )
    .bind(&slug)
    .fetch_all(&st.pool)
    .await?;

    Ok(Json(BookingContext {
        property,
        season,
        weeks,
        products,
        media,
    }))
}

// ----------------------------------------------------------------------------
// Create a booking (cart). Totals computed server-side from catalog prices.
// ----------------------------------------------------------------------------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateBooking {
    property_slug: String,
    week_id: Uuid,
    #[serde(default)]
    extras: Vec<String>,
    #[serde(default)]
    adults: Option<i32>,
    #[serde(default)]
    children: Option<i32>,
    #[serde(default)]
    customer: Option<CustomerInput>,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct CustomerInput {
    #[serde(default)]
    email: String,
    #[serde(default)]
    first_name: String,
    #[serde(default)]
    last_name: String,
    #[serde(default)]
    phone: String,
    #[serde(default)]
    address_line: String,
    #[serde(default)]
    postal_code: String,
    #[serde(default)]
    city: String,
    #[serde(default)]
    country: String,
}

#[derive(FromRow)]
struct PropRow {
    id: Uuid,
    deposit_pct: i32,
    caution_cents: i64,
}

#[derive(FromRow)]
struct WeekRow {
    id: Uuid,
    price_cents: i64,
    status: String,
    range_label: String,
}

#[derive(FromRow)]
struct ProductRow {
    id: Uuid,
    key: String,
    label: String,
    price_cents: i64,
}

#[derive(FromRow, Serialize)]
#[serde(rename_all = "camelCase")]
struct BookingDto {
    reference: String,
    status: String,
    week_price_cents: i64,
    extras_total_cents: i64,
    total_cents: i64,
    deposit_pct: i32,
    deposit_cents: i64,
    balance_cents: i64,
    caution_cents: i64,
    created_at: DateTime<Utc>,
}

async fn create_booking(
    State(st): State<AppState>,
    Json(req): Json<CreateBooking>,
) -> Result<Json<BookingDto>, AppError> {
    let prop = sqlx::query_as::<_, PropRow>(
        "select id, deposit_pct, caution_cents from property where slug = $1",
    )
    .bind(&req.property_slug)
    .fetch_optional(&st.pool)
    .await?
    .ok_or_else(|| AppError::NotFound("propriété".into()))?;

    let week = sqlx::query_as::<_, WeekRow>(
        "select id, price_cents, status, range_label \
         from availability_week where id = $1 and property_id = $2",
    )
    .bind(req.week_id)
    .bind(prop.id)
    .fetch_optional(&st.pool)
    .await?
    .ok_or_else(|| AppError::NotFound("semaine".into()))?;

    if week.status != "available" {
        return Err(AppError::BadRequest(
            "Cette semaine n'est plus disponible.".into(),
        ));
    }

    let products = if req.extras.is_empty() {
        Vec::new()
    } else {
        sqlx::query_as::<_, ProductRow>(
            "select id, key, label, price_cents from product where active and key = any($1)",
        )
        .bind(&req.extras)
        .fetch_all(&st.pool)
        .await?
    };

    for key in &req.extras {
        if !products.iter().any(|p| &p.key == key) {
            return Err(AppError::BadRequest(format!("Prestation inconnue : {key}")));
        }
    }

    let extras_prices: Vec<i64> = products.iter().map(|p| p.price_cents).collect();
    let totals = pricing::compute(week.price_cents, &extras_prices, prop.deposit_pct as i64);

    let reference = format!(
        "ADR-{}",
        &Uuid::new_v4().simple().to_string()[..6].to_uppercase()
    );

    let mut tx = st.pool.begin().await?;

    let customer_id: Option<Uuid> = match &req.customer {
        Some(c) if !c.email.trim().is_empty() => {
            let row = sqlx::query_as::<_, (Uuid,)>(
                "insert into customer \
                    (email, first_name, last_name, phone, address_line, postal_code, city, country) \
                 values ($1, $2, $3, $4, $5, $6, $7, $8) returning id",
            )
            .bind(&c.email)
            .bind(&c.first_name)
            .bind(&c.last_name)
            .bind(&c.phone)
            .bind(&c.address_line)
            .bind(&c.postal_code)
            .bind(&c.city)
            .bind(&c.country)
            .fetch_one(&mut *tx)
            .await?;
            Some(row.0)
        }
        _ => None,
    };

    let booking_id: Uuid = sqlx::query_as::<_, (Uuid,)>(
        "insert into booking \
            (reference, property_id, customer_id, week_id, status, adults, children, \
             week_price_cents, extras_total_cents, total_cents, deposit_pct, \
             deposit_cents, balance_cents, caution_cents) \
         values ($1, $2, $3, $4, 'cart', $5, $6, $7, $8, $9, $10, $11, $12, $13) returning id",
    )
    .bind(&reference)
    .bind(prop.id)
    .bind(customer_id)
    .bind(week.id)
    .bind(req.adults.unwrap_or(2))
    .bind(req.children.unwrap_or(0))
    .bind(totals.week_price_cents)
    .bind(totals.extras_total_cents)
    .bind(totals.total_cents)
    .bind(prop.deposit_pct)
    .bind(totals.deposit_cents)
    .bind(totals.balance_cents)
    .bind(prop.caution_cents)
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

    for (i, p) in products.iter().enumerate() {
        sqlx::query(
            "insert into booking_line \
                (booking_id, kind, product_id, label, quantity, unit_price_cents, total_cents, position) \
             values ($1, 'product', $2, $3, 1, $4, $4, $5)",
        )
        .bind(booking_id)
        .bind(p.id)
        .bind(&p.label)
        .bind(p.price_cents)
        .bind((i as i32) + 1)
        .execute(&mut *tx)
        .await?;
    }

    tx.commit().await?;

    let dto = fetch_booking(&st.pool, &reference).await?;
    Ok(Json(dto))
}

async fn get_booking(
    State(st): State<AppState>,
    Path(reference): Path<String>,
) -> Result<Json<BookingDto>, AppError> {
    Ok(Json(fetch_booking(&st.pool, &reference).await?))
}

async fn fetch_booking(pool: &PgPool, reference: &str) -> Result<BookingDto, AppError> {
    sqlx::query_as::<_, BookingDto>(
        "select reference, status, week_price_cents, extras_total_cents, total_cents, \
                deposit_pct, deposit_cents, balance_cents, caution_cents, created_at \
         from booking where reference = $1",
    )
    .bind(reference)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound("réservation".into()))
}

// ----------------------------------------------------------------------------
// Deposit payment (acompte). Mock-driven today; Stripe via the same provider.
// ----------------------------------------------------------------------------

#[derive(FromRow)]
struct PayRow {
    id: Uuid,
    deposit_cents: i64,
    status: String,
    week_status: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PayDepositResponse {
    provider: String,
    client_secret: String,
    publishable_key: Option<String>,
    deposit_cents: i64,
}

async fn pay_deposit(
    State(st): State<AppState>,
    Path(reference): Path<String>,
) -> Result<Json<PayDepositResponse>, AppError> {
    let b = sqlx::query_as::<_, PayRow>(
        "select b.id, b.deposit_cents, b.status, aw.status as week_status \
         from booking b join availability_week aw on aw.id = b.week_id \
         where b.reference = $1",
    )
    .bind(&reference)
    .fetch_optional(&st.pool)
    .await?
    .ok_or_else(|| AppError::NotFound("réservation".into()))?;

    if b.status != "cart" {
        return Err(AppError::BadRequest("Réservation déjà réglée.".into()));
    }
    if b.week_status != "available" {
        return Err(AppError::BadRequest(
            "Cette semaine n'est plus disponible.".into(),
        ));
    }

    let intent = st
        .payments
        .create_deposit_intent(&reference, b.deposit_cents)
        .await?;
    let provider = st.payments.name().to_string();

    let mut tx = st.pool.begin().await?;
    sqlx::query(
        "insert into payment (booking_id, type, provider, provider_intent_id, amount_cents, status) \
         values ($1, 'deposit', $2, $3, $4, 'pending')",
    )
    .bind(b.id)
    .bind(&provider)
    .bind(&intent.intent_id)
    .bind(b.deposit_cents)
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        "update booking set provider = $2, deposit_intent_id = $3, \
            provider_customer_id = coalesce($4, provider_customer_id), updated_at = now() \
         where id = $1",
    )
    .bind(b.id)
    .bind(&provider)
    .bind(&intent.intent_id)
    .bind(intent.customer_id.as_deref())
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;

    Ok(Json(PayDepositResponse {
        provider,
        client_secret: intent.client_secret,
        publishable_key: st.payments.publishable_key(),
        deposit_cents: b.deposit_cents,
    }))
}

#[derive(FromRow)]
struct ConfirmRow {
    id: Uuid,
    deposit_intent_id: Option<String>,
    customer_id: Option<Uuid>,
}

/// Confirm the deposit once the buyer has paid: reads the intent from the
/// provider (Stripe status, or always-paid for mock), marks the booking, and
/// opens a customer session (cookie) for the espace client.
async fn confirm_deposit(
    State(st): State<AppState>,
    Path(reference): Path<String>,
) -> Result<Response, AppError> {
    let b = sqlx::query_as::<_, ConfirmRow>(
        "select id, deposit_intent_id, customer_id from booking where reference = $1",
    )
    .bind(&reference)
    .fetch_optional(&st.pool)
    .await?
    .ok_or_else(|| AppError::NotFound("réservation".into()))?;

    let intent_id = b
        .deposit_intent_id
        .ok_or_else(|| AppError::BadRequest("Aucun paiement initié.".into()))?;

    let result = st.payments.retrieve_deposit(&intent_id).await?;
    if !result.paid {
        return Err(AppError::BadRequest("Paiement non confirmé.".into()));
    }

    let mut tx = st.pool.begin().await?;
    // Atomically claim the week; refuse if another confirmed booking already holds it.
    let claimed = sqlx::query(
        "update availability_week set status = 'booked' \
         where id = (select week_id from booking where id = $1) and status = 'available'",
    )
    .bind(b.id)
    .execute(&mut *tx)
    .await?;
    if claimed.rows_affected() == 0 {
        let taken: Option<i32> = sqlx::query_scalar(
            "select 1 from booking b2 \
             where b2.week_id = (select week_id from booking where id = $1) \
               and b2.id <> $1 and b2.status in ('confirmed', 'balance_paid') limit 1",
        )
        .bind(b.id)
        .fetch_optional(&mut *tx)
        .await?;
        if taken.is_some() {
            return Err(AppError::BadRequest(
                "Cette semaine vient d'être réservée par un autre client. Votre acompte vous sera remboursé.".into(),
            ));
        }
    }
    sqlx::query(
        "update payment set status = 'succeeded', updated_at = now() \
         where booking_id = $1 and type = 'deposit'",
    )
    .bind(b.id)
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        "update booking set status = 'confirmed', deposit_paid_at = now(), \
            provider_customer_id = coalesce($2, provider_customer_id), \
            provider_payment_method_id = coalesce($3, provider_payment_method_id), \
            updated_at = now() \
         where id = $1",
    )
    .bind(b.id)
    .bind(result.customer_id.as_deref())
    .bind(result.payment_method_id.as_deref())
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;

    let dto = fetch_booking(&st.pool, &reference).await?;
    let mut resp = Json(dto).into_response();
    if let Some(cid) = b.customer_id {
        let token = create_customer_session(&st.pool, cid).await?;
        resp.headers_mut().insert(
            header::SET_COOKIE,
            HeaderValue::from_str(&session_cookie(&token))
                .map_err(|_| AppError::Internal("cookie".into()))?,
        );
        send_welcome_email(&st.pool, cid, &reference).await;
    }
    Ok(resp)
}

fn session_token() -> String {
    use rand::RngCore;
    let mut b = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut b);
    b.iter().map(|x| format!("{x:02x}")).collect()
}

/// "; Secure" appended to Set-Cookie when COOKIE_SECURE=true (HTTPS production).
/// Evaluated once; without it, cookies won't be sent over HTTPS-only contexts
/// in some browsers and would be exposed if any plain-HTTP hop existed.
pub(crate) fn cookie_secure() -> &'static str {
    static SECURE: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
    if *SECURE.get_or_init(|| matches!(env::var("COOKIE_SECURE").as_deref(), Ok("true") | Ok("1")))
    {
        "; Secure"
    } else {
        ""
    }
}

fn session_cookie(token: &str) -> String {
    format!(
        "csession={token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000{}",
        cookie_secure()
    )
}

async fn create_customer_session(pool: &PgPool, cid: Uuid) -> Result<String, AppError> {
    let token = session_token();
    sqlx::query(
        "insert into customer_session (token, customer_id, expires_at) \
         values ($1, $2, now() + interval '30 days')",
    )
    .bind(&token)
    .bind(cid)
    .execute(pool)
    .await?;
    Ok(token)
}

async fn create_magic_token(pool: &PgPool, cid: Uuid) -> Result<String, AppError> {
    let token = session_token();
    sqlx::query(
        "insert into magic_link (token, customer_id, expires_at) \
         values ($1, $2, now() + interval '30 minutes')",
    )
    .bind(&token)
    .bind(cid)
    .execute(pool)
    .await?;
    Ok(token)
}

/// Welcome e-mail after a confirmed booking, with a magic link to the espace.
/// Best-effort: failures are logged, never bubbled to the payment response.
async fn send_welcome_email(pool: &PgPool, cid: Uuid, reference: &str) {
    let cust: Option<(String, String)> =
        sqlx::query_as("select email, first_name from customer where id = $1")
            .bind(cid)
            .fetch_optional(pool)
            .await
            .ok()
            .flatten();
    let Some((mail, first_name)) = cust else {
        return;
    };
    if mail.trim().is_empty() {
        return;
    }
    let link = match create_magic_token(pool, cid).await {
        Ok(t) => format!("{}/api/espace/login?token={}", email::api_url(), t),
        Err(_) => format!("{}/espace", email::front_url()),
    };
    let hello = if first_name.trim().is_empty() {
        "Bonjour,".to_string()
    } else {
        format!("Bonjour {first_name},")
    };
    let body = format!(
        "{hello}<br><br>Votre réservation <b>{reference}</b> est confirmée — merci de votre confiance. \
         Retrouvez le détail de votre séjour, les échéances de paiement et les consignes d'arrivée \
         dans votre espace personnel."
    );
    let html = email::template(
        "Votre réservation est confirmée",
        &body,
        "Accéder à mon espace",
        &link,
    );
    email::spawn(
        mail,
        "Votre réservation est confirmée — L'Adret".into(),
        html,
    );
}

#[derive(Deserialize)]
struct RequestLinkBody {
    email: String,
}

/// Ask for a magic login link. Always 204 (never leaks whether the e-mail exists).
async fn request_link(
    State(st): State<AppState>,
    Json(body): Json<RequestLinkBody>,
) -> Result<StatusCode, AppError> {
    let email_in = body.email.trim().to_string();
    if !email_in.is_empty() {
        let cid: Option<Uuid> = sqlx::query_scalar(
            "select id from customer where lower(email) = lower($1) order by created_at desc limit 1",
        )
        .bind(&email_in)
        .fetch_optional(&st.pool)
        .await?;
        if let Some(cid) = cid {
            let token = create_magic_token(&st.pool, cid).await?;
            let link = format!("{}/api/espace/login?token={}", email::api_url(), token);
            let html = email::template(
                "Connexion à votre espace",
                "Cliquez ci-dessous pour accéder à votre espace séjour. Ce lien est valable 30 minutes.",
                "Ouvrir mon espace",
                &link,
            );
            email::spawn(email_in, "Connexion à votre espace — L'Adret".into(), html);
        }
    }
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
struct LoginQuery {
    token: String,
}

/// Consume a magic link: open a session cookie and redirect to the espace.
async fn espace_login(
    State(st): State<AppState>,
    Query(q): Query<LoginQuery>,
) -> Result<Response, AppError> {
    let front = email::front_url();
    let redirect = |url: String| -> Result<Response, AppError> {
        let mut r = StatusCode::FOUND.into_response();
        r.headers_mut().insert(
            header::LOCATION,
            HeaderValue::from_str(&url).map_err(|_| AppError::Internal("redirect".into()))?,
        );
        Ok(r)
    };

    let cid: Option<Uuid> = sqlx::query_scalar(
        "update magic_link set used_at = now() \
         where token = $1 and used_at is null and expires_at > now() returning customer_id",
    )
    .bind(&q.token)
    .fetch_optional(&st.pool)
    .await?;

    let Some(cid) = cid else {
        return redirect(format!("{front}/espace?error=lien"));
    };
    let token = create_customer_session(&st.pool, cid).await?;
    let mut resp = redirect(format!("{front}/espace"))?;
    resp.headers_mut().insert(
        header::SET_COOKIE,
        HeaderValue::from_str(&session_cookie(&token))
            .map_err(|_| AppError::Internal("cookie".into()))?,
    );
    Ok(resp)
}

/// Close the current espace session and clear the cookie.
async fn espace_logout(
    State(st): State<AppState>,
    headers: HeaderMap,
) -> Result<Response, AppError> {
    if let Some(token) = headers
        .get(header::COOKIE)
        .and_then(|v| v.to_str().ok())
        .and_then(parse_csession)
    {
        sqlx::query("delete from customer_session where token = $1")
            .bind(&token)
            .execute(&st.pool)
            .await
            .ok();
    }
    let mut resp = StatusCode::NO_CONTENT.into_response();
    resp.headers_mut().insert(
        header::SET_COOKIE,
        HeaderValue::from_str(&format!(
            "csession=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0{}",
            cookie_secure()
        ))
        .map_err(|_| AppError::Internal("cookie".into()))?,
    );
    Ok(resp)
}

// ----------------------------------------------------------------------------
// Espace client (customer session).
// ----------------------------------------------------------------------------

#[derive(Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
struct CustomerDto {
    email: String,
    first_name: String,
    last_name: String,
    phone: String,
    address_line: String,
    postal_code: String,
    city: String,
}

#[derive(Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
struct MyBookingDto {
    reference: String,
    status: String,
    week_range: String,
    arrival: String,
    start_date: chrono::NaiveDate,
    total_cents: i64,
    deposit_cents: i64,
    balance_cents: i64,
    caution_cents: i64,
    deposit_paid_at: Option<DateTime<Utc>>,
    balance_paid_at: Option<DateTime<Utc>>,
    caution_authorized_at: Option<DateTime<Utc>>,
    cancelled_at: Option<DateTime<Utc>>,
    created_at: DateTime<Utc>,
}

#[derive(Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
struct MePropertyDto {
    name: String,
    location_label: String,
    arrival_instructions: String,
    house_rules: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MeResponse {
    customer: CustomerDto,
    property: Option<MePropertyDto>,
    bookings: Vec<MyBookingDto>,
}

fn parse_csession(cookie_header: &str) -> Option<String> {
    cookie_header
        .split(';')
        .find_map(|p| p.trim().strip_prefix("csession=").map(String::from))
}

async fn customer_me(
    State(st): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<MeResponse>, AppError> {
    let token = headers
        .get(header::COOKIE)
        .and_then(|v| v.to_str().ok())
        .and_then(parse_csession)
        .ok_or(AppError::Unauthorized)?;

    let cid: Uuid = sqlx::query_scalar(
        "select customer_id from customer_session where token = $1 and expires_at > now()",
    )
    .bind(&token)
    .fetch_optional(&st.pool)
    .await?
    .ok_or(AppError::Unauthorized)?;

    let customer = sqlx::query_as::<_, CustomerDto>(
        "select email, first_name, last_name, phone, address_line, postal_code, city \
         from customer where id = $1",
    )
    .bind(cid)
    .fetch_one(&st.pool)
    .await?;

    let bookings = sqlx::query_as::<_, MyBookingDto>(
        "select b.reference, b.status, aw.range_label as week_range, aw.arrival_label as arrival, \
                aw.start_date, b.total_cents, b.deposit_cents, b.balance_cents, b.caution_cents, \
                b.deposit_paid_at, b.balance_paid_at, b.caution_authorized_at, b.cancelled_at, \
                b.created_at \
         from booking b join availability_week aw on aw.id = b.week_id \
         where b.customer_id = $1 order by aw.start_date desc",
    )
    .bind(cid)
    .fetch_all(&st.pool)
    .await?;

    let property = sqlx::query_as::<_, MePropertyDto>(
        "select distinct p.name, p.location_label, p.arrival_instructions, p.house_rules \
         from property p \
         join availability_week aw on aw.property_id = p.id \
         join booking b on b.week_id = aw.id \
         where b.customer_id = $1 limit 1",
    )
    .bind(cid)
    .fetch_optional(&st.pool)
    .await?;

    Ok(Json(MeResponse {
        customer,
        property,
        bookings,
    }))
}

// ----------------------------------------------------------------------------
// Stripe webhook (async reliability). Confirms the deposit idempotently.
// ----------------------------------------------------------------------------

fn verify_stripe_signature(payload: &[u8], sig_header: &str, secret: &str) -> bool {
    use hmac::{Hmac, Mac};
    use sha2::Sha256;

    let mut timestamp = None;
    let mut signatures = Vec::new();
    for part in sig_header.split(',') {
        if let Some((k, v)) = part.split_once('=') {
            match k {
                "t" => timestamp = Some(v),
                "v1" => signatures.push(v),
                _ => {}
            }
        }
    }
    let Some(t) = timestamp else { return false };
    let Ok(payload_str) = std::str::from_utf8(payload) else {
        return false;
    };
    let signed = format!("{t}.{payload_str}");
    let Ok(mut mac) = Hmac::<Sha256>::new_from_slice(secret.as_bytes()) else {
        return false;
    };
    mac.update(signed.as_bytes());
    let expected = hex::encode(mac.finalize().into_bytes());
    signatures.iter().any(|s| s.eq_ignore_ascii_case(&expected))
}

async fn stripe_webhook(
    State(st): State<AppState>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<StatusCode, AppError> {
    if let Ok(secret) = env::var("STRIPE_WEBHOOK_SECRET") {
        if !secret.is_empty() {
            let sig = headers
                .get("stripe-signature")
                .and_then(|v| v.to_str().ok())
                .unwrap_or_default();
            if !verify_stripe_signature(&body, sig, &secret) {
                return Err(AppError::BadRequest("Signature webhook invalide.".into()));
            }
        }
    }

    let event: serde_json::Value = serde_json::from_slice(&body)
        .map_err(|_| AppError::BadRequest("Payload webhook invalide.".into()))?;
    let kind = event
        .get("type")
        .and_then(|t| t.as_str())
        .unwrap_or_default();

    if kind == "payment_intent.succeeded" {
        let pi = &event["data"]["object"];
        let intent_id = pi.get("id").and_then(|v| v.as_str()).unwrap_or_default();
        let customer = pi.get("customer").and_then(|v| v.as_str());
        let pm = pi.get("payment_method").and_then(|v| v.as_str());

        let mut tx = st.pool.begin().await?;
        let updated = sqlx::query(
            "update booking set status = 'confirmed', \
                deposit_paid_at = coalesce(deposit_paid_at, now()), \
                provider_customer_id = coalesce(provider_customer_id, $2), \
                provider_payment_method_id = coalesce(provider_payment_method_id, $3), \
                updated_at = now() \
             where deposit_intent_id = $1 and status = 'cart'",
        )
        .bind(intent_id)
        .bind(customer)
        .bind(pm)
        .execute(&mut *tx)
        .await?;
        sqlx::query(
            "update payment set status = 'succeeded', updated_at = now() \
             where provider_intent_id = $1",
        )
        .bind(intent_id)
        .execute(&mut *tx)
        .await?;
        sqlx::query(
            "update availability_week set status = 'booked' \
             where id in (select week_id from booking where deposit_intent_id = $1) \
               and status <> 'booked'",
        )
        .bind(intent_id)
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
        if updated.rows_affected() > 0 {
            tracing::info!("webhook: acompte confirmé (intent {intent_id})");
        }
    }

    Ok(StatusCode::OK)
}

/// Seed the first admin user from ADMIN_EMAIL/ADMIN_PASSWORD if none exists yet.
async fn seed_admin(pool: &PgPool) -> anyhow::Result<()> {
    let (email, password) = match (env::var("ADMIN_EMAIL"), env::var("ADMIN_PASSWORD")) {
        (Ok(e), Ok(p)) if !e.is_empty() && !p.is_empty() => (e, p),
        _ => return Ok(()),
    };
    let count: i64 = sqlx::query_scalar("select count(*) from admin_user")
        .fetch_one(pool)
        .await?;
    if count == 0 {
        let hash = admin::hash_password(&password)?;
        sqlx::query(
            "insert into admin_user (email, password_hash, display_name) values ($1,$2,$3)",
        )
        .bind(email.trim().to_lowercase())
        .bind(hash)
        .bind("Admin")
        .execute(pool)
        .await?;
        tracing::info!("seeded initial admin user");
    }
    Ok(())
}
