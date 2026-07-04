mod accounting;
mod admin;
mod campaigns;
mod email;
mod error;
mod i18n;
mod ical;
mod media;
mod payments;
mod pricing;
mod rate;
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
    pub(crate) rate: std::sync::Arc<rate::RateLimiter>,
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

    // Fail closed in production: the mock payment provider always reports success,
    // so booting with it in prod would confirm bookings without real charges.
    if is_production() && !payments::stripe_active() {
        anyhow::bail!(
            "Production détectée (APP_ENV=production ou COOKIE_SECURE=true) mais le provider \
             de paiement 'mock' est actif : STRIPE_SECRET_KEY manquante ou invalide. \
             Refus de démarrer pour éviter des réservations confirmées sans paiement réel."
        );
    }

    let state = AppState {
        pool,
        media_dir: std::sync::Arc::new(media_dir.clone()),
        payments: payments::from_env(),
        rate: std::sync::Arc::new(rate::RateLimiter::new()),
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
    // Variantes d'images manquantes (photos uploadées avant la fonctionnalité).
    media::spawn_backfill(state.pool.clone(), state.media_dir.clone());

    let app = Router::new()
        .route("/api/health", get(health))
        .route("/api/public-settings", get(public_settings))
        .route("/api/booking-context/:slug", get(booking_context))
        .route("/api/bookings", post(create_booking))
        .route("/api/bookings/:reference", get(get_booking))
        .route("/api/bookings/:reference/resume", get(resume_booking))
        .route("/api/me", get(customer_me))
        .route("/api/espace/request-link", post(request_link))
        .route("/api/espace/login", get(espace_login))
        .route("/api/espace/logout", post(espace_logout))
        .route("/api/bookings/:reference/contract", post(sign_contract))
        .route(
            "/api/contract/:token",
            get(contract_link_view).post(contract_link_sign),
        )
        .route("/api/bookings/:reference/pay-deposit", post(pay_deposit))
        .route(
            "/api/bookings/:reference/reserve-offline",
            post(reserve_offline),
        )
        .route(
            "/api/bookings/:reference/confirm-deposit",
            post(confirm_deposit),
        )
        .route("/api/bookings/:reference/pay-balance", post(pay_balance))
        .route(
            "/api/bookings/:reference/confirm-balance",
            post(confirm_balance),
        )
        .route(
            "/api/avis/:token",
            get(review_link_view).post(review_link_submit),
        )
        .route("/api/calendar/:token", get(ical_feed))
        .route("/api/payments/webhook", post(stripe_webhook))
        .route("/api/emails/webhook", post(resend_webhook))
        .with_state(state.clone())
        .nest("/api/admin", admin::routes(state.clone()))
        // Serve uploaded photos.
        .nest_service("/media", tower_http::services::ServeDir::new(media_dir))
        .layer(cors)
        .layer(TraceLayer::new_for_http());

    let listener = tokio::net::TcpListener::bind(&bind).await?;
    tracing::info!("API listening on http://{bind}");
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await?;
    tracing::info!("arrêt terminé");
    Ok(())
}

/// Resolve on SIGTERM (docker stop / deploy) or Ctrl-C so in-flight requests —
/// e.g. a payment confirmation mid-transaction — drain before the process exits
/// instead of being cut off.
async fn shutdown_signal() {
    use tokio::signal;
    let ctrl_c = async {
        let _ = signal::ctrl_c().await;
    };
    #[cfg(unix)]
    let terminate = async {
        match signal::unix::signal(signal::unix::SignalKind::terminate()) {
            Ok(mut s) => {
                s.recv().await;
            }
            Err(e) => tracing::error!("handler SIGTERM: {e:?}"),
        }
    };
    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();
    tokio::select! {
        _ = ctrl_c => {}
        _ = terminate => {}
    }
    tracing::info!("arrêt gracieux demandé — drainage des requêtes en cours");
}

/// Readiness probe (used as the API container healthcheck): verifies the database
/// is actually reachable, so a live process with a dead pool is reported unhealthy
/// (503) and the proxy stops routing to it instead of serving 500s to customers.
async fn health(State(st): State<AppState>) -> Response {
    match sqlx::query_scalar::<_, i32>("select 1")
        .fetch_one(&st.pool)
        .await
    {
        Ok(_) => (StatusCode::OK, Json(serde_json::json!({ "status": "ok" }))).into_response(),
        Err(e) => {
            tracing::warn!("health: base de données indisponible: {e:?}");
            (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(serde_json::json!({ "status": "degraded", "db": false })),
            )
                .into_response()
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PublicSettings {
    english_enabled: bool,
}

async fn public_settings(State(st): State<AppState>) -> Result<Json<PublicSettings>, AppError> {
    let english_enabled =
        sqlx::query_scalar::<_, bool>("select english_enabled from property limit 1")
            .fetch_optional(&st.pool)
            .await?
            .unwrap_or(true);
    Ok(Json(PublicSettings { english_enabled }))
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
    tourist_tax_cents: i64,
    tourist_tax_included: bool,
    owner_name: String,
    owner_address: String,
    online_booking_enabled: bool,
    pay_card_enabled: bool,
    pay_cheque_enabled: bool,
    pay_virement_enabled: bool,
    instructions_cheque: String,
    instructions_virement: String,
    contract_template: String,
    amenities: sqlx::types::Json<Vec<AmenityDto>>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct AmenityDto {
    icon: String,
    label: String,
    #[serde(default)]
    label_en: String,
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
    /// Colonnes techniques pour recalculer les libellés dans une autre langue
    /// (les libellés stockés sont français) — jamais sérialisées.
    #[serde(skip)]
    end_date: NaiveDate,
    #[serde(skip)]
    tier_key: Option<String>,
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
    /// Largeurs des variantes redimensionnées disponibles (voir media.rs) —
    /// le front choisit la taille adaptée ; vide = original seulement.
    widths: Vec<i32>,
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
    rate_tiers: serde_json::Value,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BookingContext {
    property: PropertyDto,
    season: Option<PublicSeason>,
    weeks: Vec<WeekDto>,
    products: Vec<ProductDto>,
    media: Vec<PublicMediaDto>,
    reviews: Vec<PublicReviewDto>,
}

#[derive(Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
struct PublicReviewDto {
    author_name: String,
    rating: i32,
    comment: String,
    admin_reply: Option<String>,
    submitted_at: DateTime<Utc>,
}

#[derive(Deserialize)]
struct LocaleQuery {
    #[serde(default)]
    locale: Option<String>,
}

async fn booking_context(
    State(st): State<AppState>,
    Path(slug): Path<String>,
    Query(q): Query<LocaleQuery>,
) -> Result<Json<BookingContext>, AppError> {
    let lang = i18n::Lang::from_param(q.locale.as_deref());
    let mut property = sqlx::query_as::<_, PropertyDto>(
        "select slug, name, location_label, description, surface_label, capacity, bedrooms, \
                specs_label, highlight_label, hero_seed, deposit_pct, caution_cents, \
                tourist_tax_cents, tourist_tax_included, owner_name, owner_address, \
                online_booking_enabled, pay_card_enabled, pay_cheque_enabled, \
                pay_virement_enabled, instructions_cheque, instructions_virement, \
                contract_template, amenities \
         from property where slug = $1",
    )
    .bind(&slug)
    .fetch_optional(&st.pool)
    .await?
    .ok_or_else(|| AppError::NotFound("propriété".into()))?;

    // Contenus éditoriaux traduits (jsonb) : overlay sur les champs français.
    if lang != i18n::Lang::Fr {
        let tr: serde_json::Value =
            sqlx::query_scalar("select translations from property where slug = $1")
                .bind(&slug)
                .fetch_one(&st.pool)
                .await?;
        property.description = i18n::tr_field(&tr, lang, "description", &property.description);
        property.surface_label = i18n::tr_field(&tr, lang, "surfaceLabel", &property.surface_label);
        property.specs_label = i18n::tr_field(&tr, lang, "specsLabel", &property.specs_label);
        property.highlight_label =
            i18n::tr_field(&tr, lang, "highlightLabel", &property.highlight_label);
        property.location_label =
            i18n::tr_field(&tr, lang, "locationLabel", &property.location_label);
        property.instructions_cheque = i18n::tr_field(
            &tr,
            lang,
            "instructionsCheque",
            &property.instructions_cheque,
        );
        property.instructions_virement = i18n::tr_field(
            &tr,
            lang,
            "instructionsVirement",
            &property.instructions_virement,
        );
        property.contract_template =
            i18n::tr_field(&tr, lang, "contractTemplate", &property.contract_template);
    }

    // Public site shows only the active season's weeks.
    let active = sqlx::query_as::<_, ActiveSeasonRow>(
        "select s.id, s.name, s.start_date, s.end_date, s.rate_tiers \
         from season s join property p on p.id = s.property_id \
         where p.slug = $1 and s.is_active order by s.start_date limit 1",
    )
    .bind(&slug)
    .fetch_optional(&st.pool)
    .await?;

    let mut weeks =
        match &active {
            Some(a) => sqlx::query_as::<_, WeekDto>(
                "select aw.id, aw.start_date, aw.range_label as \"range\", aw.sub_label as sub, \
                        aw.price_cents, aw.status, (aw.status = 'booked') as booked, \
                        aw.arrival_label as arrival, aw.arrival_short as arr_short, \
                        aw.depart_short as dep_short, aw.balance_due_label as balance_due, \
                        aw.end_date, aw.tier_key \
                 from availability_week aw \
                 where aw.season_id = $1 and aw.status <> 'blocked' \
                 order by aw.start_date, aw.position",
            )
            .bind(a.id)
            .fetch_all(&st.pool)
            .await?,
            None => Vec::new(),
        };

    // Libellés stockés = français canonique ; autre langue = recalcul à la
    // volée depuis les dates (+ labelEn des paliers pour la mention).
    if lang != i18n::Lang::Fr {
        let tiers = active
            .as_ref()
            .map(|a| a.rate_tiers.clone())
            .unwrap_or(serde_json::Value::Null);
        for w in &mut weeks {
            w.range = i18n::range_label(w.start_date, w.end_date, lang);
            w.arrival = i18n::arrival_full(w.start_date, lang);
            w.arr_short = i18n::short_label(w.start_date, lang);
            w.dep_short = i18n::short_label(w.end_date, lang);
            w.balance_due = i18n::balance_due_label(w.start_date, lang);
            w.sub = i18n::tier_label(&tiers, w.tier_key.as_deref(), lang, &w.sub);
        }
    }

    let season = active.map(|a| PublicSeason {
        name: a.name,
        start_date: a.start_date,
        end_date: a.end_date,
    });

    let mut products = sqlx::query_as::<_, ProductDto>(
        "select key, label, description, price_cents from product where active order by position",
    )
    .fetch_all(&st.pool)
    .await?;

    if lang != i18n::Lang::Fr {
        let product_tr: Vec<(String, serde_json::Value)> =
            sqlx::query_as("select key, translations from product where active")
                .fetch_all(&st.pool)
                .await?;
        for p in &mut products {
            if let Some((_, tr)) = product_tr.iter().find(|(k, _)| k == &p.key) {
                p.label = i18n::tr_field(tr, lang, "label", &p.label);
                p.description = i18n::tr_field(tr, lang, "description", &p.description);
            }
        }
    }

    let media = sqlx::query_as::<_, PublicMediaDto>(
        "select '/media/' || pm.filename as url, pm.alt, \
                array_remove(pm.widths, -1) as widths \
         from property_media pm join property p on p.id = pm.property_id \
         where p.slug = $1 order by pm.position, pm.created_at",
    )
    .bind(&slug)
    .fetch_all(&st.pool)
    .await?;

    // Avis coupés dans les réglages → liste vide, le front masque les sections.
    let reviews = sqlx::query_as::<_, PublicReviewDto>(
        "select r.author_name, r.rating, r.comment, r.admin_reply, r.submitted_at \
         from review r \
         join booking b on b.id = r.booking_id \
         join property p on p.id = b.property_id \
         where p.slug = $1 and r.published and p.reviews_enabled \
         order by r.submitted_at desc",
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
        reviews,
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
    /// Langue du parcours (fr/en) — pilote la langue des e-mails du client.
    #[serde(default)]
    locale: String,
}

#[derive(FromRow)]
struct PropRow {
    id: Uuid,
    deposit_pct: i32,
    caution_cents: i64,
    tourist_tax_cents: i64,
    tourist_tax_included: bool,
    capacity: i32,
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
    tourist_tax_cents: i64,
    created_at: DateTime<Utc>,
}

async fn create_booking(
    State(st): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<CreateBooking>,
) -> Result<Json<BookingDto>, AppError> {
    // Anti-spam: cap cart creation per client IP.
    st.rate.check(
        "bookings",
        &rate::client_ip(&headers),
        20,
        std::time::Duration::from_secs(600),
    )?;

    let prop = sqlx::query_as::<_, PropRow>(
        "select id, deposit_pct, caution_cents, tourist_tax_cents, tourist_tax_included, capacity \
         from property where slug = $1",
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

    // Interrupteur global : réservation en ligne fermée par l'admin.
    let online_enabled: bool =
        sqlx::query_scalar("select online_booking_enabled from property where id = $1")
            .bind(prop.id)
            .fetch_one(&st.pool)
            .await?;
    if !online_enabled {
        return Err(AppError::BadRequest(
            "La réservation en ligne est momentanément fermée. Contactez-nous directement.".into(),
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
    // Validate the party size server-side: at least one adult (also so the tourist
    // tax, adults × nights, can't be zeroed with adults=0), no negatives, and within
    // the property's capacity — the client-supplied counts drive tax and occupancy.
    let adults = req.adults.unwrap_or(2);
    let children = req.children.unwrap_or(0);
    if adults < 1 {
        return Err(AppError::BadRequest(
            "Au moins un adulte est requis.".into(),
        ));
    }
    if children < 0 {
        return Err(AppError::BadRequest("Nombre d'enfants invalide.".into()));
    }
    if adults + children > prop.capacity {
        return Err(AppError::BadRequest(format!(
            "Le nombre de voyageurs dépasse la capacité du logement ({} personnes).",
            prop.capacity
        )));
    }
    let totals = pricing::compute(
        week.price_cents,
        &extras_prices,
        prop.deposit_pct as i64,
        prop.tourist_tax_cents,
        adults as i64,
        pricing::NIGHTS_PER_WEEK,
        prop.tourist_tax_included,
    );

    let reference = format!(
        "ADR-{}",
        &Uuid::new_v4().simple().to_string()[..6].to_uppercase()
    );

    let mut tx = st.pool.begin().await?;

    let customer_id: Option<Uuid> = match &req.customer {
        Some(c) if !c.email.trim().is_empty() => {
            // Upsert by e-mail (case-insensitive unique index): a returning client
            // keeps a single customer row, so /espace and the magic-link login show
            // all their bookings instead of a fragment per attempt.
            let row = sqlx::query_as::<_, (Uuid,)>(
                "insert into customer \
                    (email, first_name, last_name, phone, address_line, postal_code, city, country, locale) \
                 values ($1, $2, $3, $4, $5, $6, $7, $8, $9) \
                 on conflict (lower(email)) where coalesce(email, '') <> '' \
                 do update set \
                    first_name = excluded.first_name, last_name = excluded.last_name, \
                    phone = excluded.phone, address_line = excluded.address_line, \
                    postal_code = excluded.postal_code, city = excluded.city, \
                    country = excluded.country, locale = excluded.locale \
                 returning id",
            )
            .bind(&c.email)
            .bind(&c.first_name)
            .bind(&c.last_name)
            .bind(&c.phone)
            .bind(&c.address_line)
            .bind(&c.postal_code)
            .bind(&c.city)
            .bind(&c.country)
            .bind(i18n::Lang::from_param(Some(&c.locale)).as_str())
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
             deposit_cents, balance_cents, caution_cents, tourist_tax_cents) \
         values ($1, $2, $3, $4, 'cart', $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) returning id",
    )
    .bind(&reference)
    .bind(prop.id)
    .bind(customer_id)
    .bind(week.id)
    .bind(adults)
    .bind(children)
    .bind(totals.week_price_cents)
    .bind(totals.extras_total_cents)
    .bind(totals.total_cents)
    .bind(prop.deposit_pct)
    .bind(totals.deposit_cents)
    .bind(totals.balance_cents)
    .bind(prop.caution_cents)
    .bind(totals.tourist_tax_cents)
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
    headers: HeaderMap,
    Path(reference): Path<String>,
) -> Result<Json<BookingDto>, AppError> {
    // The reference (6 hex) is a public identifier, not a secret, and this endpoint
    // leaks a booking's existence/status. Throttle per IP so it can't be used as an
    // unbounded enumeration oracle to find confirmed references to target.
    st.rate.check(
        "get_booking",
        &rate::client_ip(&headers),
        30,
        std::time::Duration::from_secs(600),
    )?;
    Ok(Json(fetch_booking(&st.pool, &reference).await?))
}

/// Reprise de panier : l'e-mail de relance renvoie vers
/// `/reserver?ref=<reference>` et le funnel restaure la sélection + les
/// coordonnées via cet endpoint. Uniquement pour un panier (`status='cart'`,
/// expiré au bout de 48 h) ; toute autre référence → 404 indistinct. Rate-limité
/// sévèrement : la référence (6 hex) est le seul secret de l'URL.
#[derive(FromRow)]
struct ResumeRow {
    id: Uuid,
    reference: String,
    week_id: Uuid,
    adults: i32,
    children: i32,
    first_name: Option<String>,
    last_name: Option<String>,
    email: Option<String>,
    phone: Option<String>,
    address_line: Option<String>,
    postal_code: Option<String>,
    city: Option<String>,
}

async fn resume_booking(
    State(st): State<AppState>,
    headers: HeaderMap,
    Path(reference): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    st.rate.check(
        "resume",
        &rate::client_ip(&headers),
        10,
        std::time::Duration::from_secs(600),
    )?;
    let row = sqlx::query_as::<_, ResumeRow>(
        "select b.id, b.reference, b.week_id, b.adults, b.children, \
                c.first_name, c.last_name, c.email, c.phone, \
                c.address_line, c.postal_code, c.city \
         from booking b join customer c on c.id = b.customer_id \
         where b.reference = $1 and b.status = 'cart'",
    )
    .bind(&reference)
    .fetch_optional(&st.pool)
    .await?
    .ok_or_else(|| AppError::NotFound("réservation".into()))?;

    let extras: Vec<String> = sqlx::query_scalar(
        "select p.key from booking_line l join product p on p.id = l.product_id \
         where l.booking_id = $1 and l.kind = 'product' order by l.position",
    )
    .bind(row.id)
    .fetch_all(&st.pool)
    .await?;

    Ok(Json(serde_json::json!({
        "reference": row.reference,
        "weekId": row.week_id,
        "adults": row.adults,
        "children": row.children,
        "extras": extras,
        "customer": {
            "firstName": row.first_name.unwrap_or_default(),
            "lastName": row.last_name.unwrap_or_default(),
            "email": row.email.unwrap_or_default(),
            "phone": row.phone.unwrap_or_default(),
            "addressLine": row.address_line.unwrap_or_default(),
            "postalCode": row.postal_code.unwrap_or_default(),
            "city": row.city.unwrap_or_default(),
        },
    })))
}

async fn fetch_booking(pool: &PgPool, reference: &str) -> Result<BookingDto, AppError> {
    sqlx::query_as::<_, BookingDto>(
        "select reference, status, week_price_cents, extras_total_cents, total_cents, \
                deposit_pct, deposit_cents, balance_cents, caution_cents, tourist_tax_cents, \
                created_at \
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
    contract_accepted_at: Option<DateTime<Utc>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ContractInput {
    contract_version: String,
    signature_png: String,
    accepted: bool,
    #[serde(default)]
    contract_text: String,
}

// ---------------------------------------------------------------------------
// Signature du contrat par lien (réservations manuelles) : le jeton est une
// capability — il donne accès au contrat de CE dossier, avant et après
// signature (copie consultable/imprimable pour le client).
// ---------------------------------------------------------------------------

#[derive(Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
struct ContractLinkView {
    reference: String,
    week_range: String,
    arrival: String,
    customer_name: Option<String>,
    property_name: String,
    location_label: String,
    capacity: i32,
    caution_cents: i64,
    owner_name: String,
    owner_address: String,
    contract_template: String,
    signed: bool,
    signed_at: Option<DateTime<Utc>>,
    contract_text: Option<String>,
    signature_png: Option<String>,
    #[serde(skip)]
    start_date: NaiveDate,
    #[serde(skip)]
    end_date: NaiveDate,
    #[serde(skip)]
    translations: serde_json::Value,
}

async fn contract_link_view(
    State(st): State<AppState>,
    Path(token): Path<String>,
    Query(q): Query<LocaleQuery>,
) -> Result<Json<ContractLinkView>, AppError> {
    let lang = i18n::Lang::from_param(q.locale.as_deref());
    let mut row = sqlx::query_as::<_, ContractLinkView>(
        "select b.reference, aw.range_label as week_range, aw.arrival_label as arrival, \
                nullif(trim(coalesce(c.first_name,'') || ' ' || coalesce(c.last_name,'')), '') as customer_name, \
                p.name as property_name, p.location_label, p.capacity, b.caution_cents, \
                p.owner_name, p.owner_address, p.contract_template, \
                (b.contract_accepted_at is not null) as signed, \
                b.contract_accepted_at as signed_at, b.contract_text, \
                case when b.contract_accepted_at is not null then b.signature_png end as signature_png, \
                aw.start_date, aw.end_date, p.translations \
         from booking b \
         join availability_week aw on aw.id = b.week_id \
         join property p on p.id = b.property_id \
         left join customer c on c.id = b.customer_id \
         where b.contract_sign_token = $1 and b.status in ('confirmed','balance_paid')",
    )
    .bind(&token)
    .fetch_optional(&st.pool)
    .await?
    .ok_or_else(|| AppError::NotFound("contrat".into()))?;
    // Le texte déjà signé reste tel qu'archivé ; pour un contrat à signer, le
    // gabarit et les libellés suivent la langue demandée.
    if lang != i18n::Lang::Fr {
        row.week_range = i18n::range_label(row.start_date, row.end_date, lang);
        row.arrival = i18n::arrival_full(row.start_date, lang);
        row.contract_template = i18n::tr_field(
            &row.translations,
            lang,
            "contractTemplate",
            &row.contract_template,
        );
        row.location_label = i18n::tr_field(
            &row.translations,
            lang,
            "locationLabel",
            &row.location_label,
        );
    }
    Ok(Json(row))
}

/// Signe le contrat d'un dossier via son jeton (mêmes garde-fous que le
/// funnel : PNG borné, une seule signature).
async fn contract_link_sign(
    State(st): State<AppState>,
    headers: HeaderMap,
    Path(token): Path<String>,
    Json(body): Json<ContractInput>,
) -> Result<StatusCode, AppError> {
    st.rate.check(
        "contract-sign",
        &crate::rate::client_ip(&headers),
        10,
        std::time::Duration::from_secs(600),
    )?;
    if !body.accepted {
        return Err(AppError::BadRequest("Le contrat doit être accepté.".into()));
    }
    if !body.signature_png.starts_with("data:image/png") || body.signature_png.len() < 200 {
        return Err(AppError::BadRequest(
            "Signature manquante ou invalide.".into(),
        ));
    }
    if body.signature_png.len() > 1_000_000 {
        return Err(AppError::BadRequest("Signature trop volumineuse.".into()));
    }
    let contract_text =
        (!body.contract_text.trim().is_empty()).then_some(body.contract_text.as_str());
    let updated = sqlx::query(
        "update booking set contract_version = $2, signature_png = $3, \
            contract_text = $4, contract_accepted_at = now(), updated_at = now() \
         where contract_sign_token = $1 and contract_accepted_at is null \
           and status in ('confirmed','balance_paid')",
    )
    .bind(&token)
    .bind(&body.contract_version)
    .bind(&body.signature_png)
    .bind(contract_text)
    .execute(&st.pool)
    .await?;
    if updated.rows_affected() == 0 {
        return Err(AppError::BadRequest(
            "Contrat introuvable ou déjà signé.".into(),
        ));
    }
    Ok(StatusCode::NO_CONTENT)
}

// ---------------------------------------------------------------------------
// Avis voyageurs par lien : le jeton (review_token) est une capability posée
// à la demande d'avis post-départ. Une seule soumission par dossier ; l'avis
// n'apparaît sur le site qu'une fois publié par l'admin.
// ---------------------------------------------------------------------------

#[derive(Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
struct ReviewLinkView {
    property_name: String,
    location_label: String,
    week_range: String,
    first_name: Option<String>,
    submitted: bool,
    rating: Option<i32>,
    comment: Option<String>,
}

async fn review_link_view(
    State(st): State<AppState>,
    Path(token): Path<String>,
) -> Result<Json<ReviewLinkView>, AppError> {
    let row = sqlx::query_as::<_, ReviewLinkView>(
        "select p.name as property_name, p.location_label, aw.range_label as week_range, \
                c.first_name, (r.id is not null) as submitted, r.rating, r.comment \
         from booking b \
         join availability_week aw on aw.id = b.week_id \
         join property p on p.id = b.property_id \
         left join customer c on c.id = b.customer_id \
         left join review r on r.booking_id = b.id \
         where b.review_token = $1",
    )
    .bind(&token)
    .fetch_optional(&st.pool)
    .await?
    .ok_or_else(|| AppError::NotFound("avis".into()))?;
    Ok(Json(row))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReviewInput {
    rating: i32,
    #[serde(default)]
    comment: String,
    #[serde(default)]
    author_name: String,
}

async fn review_link_submit(
    State(st): State<AppState>,
    headers: HeaderMap,
    Path(token): Path<String>,
    Json(body): Json<ReviewInput>,
) -> Result<StatusCode, AppError> {
    st.rate.check(
        "review-submit",
        &crate::rate::client_ip(&headers),
        10,
        std::time::Duration::from_secs(600),
    )?;
    if !(1..=5).contains(&body.rating) {
        return Err(AppError::BadRequest("Note invalide (1 à 5).".into()));
    }
    if body.comment.len() > 4000 || body.author_name.len() > 120 {
        return Err(AppError::BadRequest("Avis trop long.".into()));
    }
    // Signature par défaut : le prénom du client du dossier.
    let inserted = sqlx::query(
        "insert into review (booking_id, rating, comment, author_name) \
         select b.id, $2, $3, \
                coalesce(nullif(trim($4), ''), nullif(trim(coalesce(c.first_name, '')), ''), 'Voyageur') \
         from booking b left join customer c on c.id = b.customer_id \
         where b.review_token = $1 \
         on conflict (booking_id) do nothing",
    )
    .bind(&token)
    .bind(body.rating)
    .bind(body.comment.trim())
    .bind(&body.author_name)
    .execute(&st.pool)
    .await?;
    if inserted.rows_affected() == 0 {
        // Jeton inconnu ou avis déjà déposé — le GET distingue les deux côté front.
        return Err(AppError::BadRequest(
            "Avis introuvable ou déjà déposé.".into(),
        ));
    }
    Ok(StatusCode::NO_CONTENT)
}

// ---------------------------------------------------------------------------
// Flux iCal du calendrier : URL secrète par propriété (jeton capability), à
// importer dans Airbnb/Booking/Google Agenda pour éviter les doubles
// réservations multi-canaux. Semaines réservées et bloquées = occupé.
// ---------------------------------------------------------------------------

async fn ical_feed(
    State(st): State<AppState>,
    Path(token): Path<String>,
) -> Result<Response, AppError> {
    let token = token.trim_end_matches(".ics");
    let prop: Option<(Uuid, String)> =
        sqlx::query_as("select id, name from property where ical_token = $1")
            .bind(token)
            .fetch_optional(&st.pool)
            .await?;
    let (property_id, name) = prop.ok_or_else(|| AppError::NotFound("calendrier".into()))?;

    let weeks: Vec<(Uuid, NaiveDate, NaiveDate, String)> = sqlx::query_as(
        "select id, start_date, end_date, status from availability_week \
         where property_id = $1 and status in ('booked','blocked') \
         order by start_date",
    )
    .bind(property_id)
    .fetch_all(&st.pool)
    .await?;

    let stamp = Utc::now().format("%Y%m%dT%H%M%SZ");
    let mut ics = format!(
        "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//{}//lesmenuires//FR\r\nCALSCALE:GREGORIAN\r\n",
        ical_escape(&name)
    );
    ics.push_str(&format!("X-WR-CALNAME:{}\r\n", ical_escape(&name)));
    for (id, start, end, status) in weeks {
        let summary = if status == "booked" {
            "Réservé"
        } else {
            "Indisponible"
        };
        ics.push_str(&format!(
            "BEGIN:VEVENT\r\nUID:{id}@lesmenuires\r\nDTSTAMP:{stamp}\r\nDTSTART;VALUE=DATE:{}\r\nDTEND;VALUE=DATE:{}\r\nSUMMARY:{} — {}\r\nTRANSP:OPAQUE\r\nEND:VEVENT\r\n",
            start.format("%Y%m%d"),
            end.format("%Y%m%d"),
            ical_escape(summary),
            ical_escape(&name),
        ));
    }
    ics.push_str("END:VCALENDAR\r\n");

    Ok((
        [
            (header::CONTENT_TYPE, "text/calendar; charset=utf-8"),
            (header::CACHE_CONTROL, "no-cache"),
        ],
        ics,
    )
        .into_response())
}

/// Échappe une valeur texte iCalendar (RFC 5545 §3.3.11).
fn ical_escape(s: &str) -> String {
    s.replace('\\', "\\\\")
        .replace(';', "\\;")
        .replace(',', "\\,")
        .replace('\n', "\\n")
}

/// Store the signed contract (version + drawn signature + acceptance timestamp)
/// as legal evidence, before payment. Only a pending cart can be signed.
async fn sign_contract(
    State(st): State<AppState>,
    headers: HeaderMap,
    Path(reference): Path<String>,
    Json(body): Json<ContractInput>,
) -> Result<StatusCode, AppError> {
    // Unauthenticated write on a public cart reference: throttle per IP so it can't be
    // used to overwrite signatures / spam ~1 MB payloads across guessed references.
    st.rate.check(
        "sign_contract",
        &rate::client_ip(&headers),
        20,
        std::time::Duration::from_secs(600),
    )?;
    if !body.accepted {
        return Err(AppError::BadRequest("Le contrat doit être accepté.".into()));
    }
    // Shape check: the signature is a canvas PNG data URL of non-trivial size.
    // Pinning the type to PNG (what the funnel produces) keeps the legal-evidence
    // artifact to a known raster format — no SVG/other payloads stored as a signature.
    if !body.signature_png.starts_with("data:image/png") || body.signature_png.len() < 200 {
        return Err(AppError::BadRequest(
            "Signature manquante ou invalide.".into(),
        ));
    }
    // Guard against absurdly large payloads (data URLs are ~a few KB normally).
    if body.signature_png.len() > 1_000_000 {
        return Err(AppError::BadRequest("Signature trop volumineuse.".into()));
    }
    let contract_text =
        (!body.contract_text.trim().is_empty()).then_some(body.contract_text.as_str());
    let updated = sqlx::query(
        "update booking set contract_version = $2, signature_png = $3, \
            contract_text = $4, contract_accepted_at = now(), updated_at = now() \
         where reference = $1 and status = 'cart'",
    )
    .bind(&reference)
    .bind(&body.contract_version)
    .bind(&body.signature_png)
    .bind(contract_text)
    .execute(&st.pool)
    .await?;
    if updated.rows_affected() == 0 {
        return Err(AppError::BadRequest(
            "Réservation introuvable ou déjà réglée.".into(),
        ));
    }
    Ok(StatusCode::NO_CONTENT)
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
    headers: HeaderMap,
    Path(reference): Path<String>,
) -> Result<Json<PayDepositResponse>, AppError> {
    // Unauthenticated: creates a payment intent per call. Throttle per IP so guessed
    // references can't be used to spin up Stripe intents in bulk.
    st.rate.check(
        "pay_deposit",
        &rate::client_ip(&headers),
        20,
        std::time::Duration::from_secs(600),
    )?;
    let b = sqlx::query_as::<_, PayRow>(
        "select b.id, b.deposit_cents, b.status, aw.status as week_status, \
                b.contract_accepted_at \
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
    let online_enabled: bool = sqlx::query_scalar(
        "select p.online_booking_enabled from property p \
         join booking b on b.property_id = p.id where b.reference = $1",
    )
    .bind(&reference)
    .fetch_one(&st.pool)
    .await?;
    if !online_enabled {
        return Err(AppError::BadRequest(
            "La réservation en ligne est momentanément fermée. Contactez-nous directement.".into(),
        ));
    }
    if b.week_status != "available" {
        return Err(AppError::BadRequest(
            "Cette semaine n'est plus disponible.".into(),
        ));
    }
    // Legal gate: no deposit without a signed contract on record.
    if b.contract_accepted_at.is_none() {
        return Err(AppError::BadRequest(
            "Le contrat doit être signé avant le paiement.".into(),
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

#[derive(Deserialize)]
struct ReserveOfflineInput {
    method: String, // "cheque" | "virement"
}

#[derive(FromRow)]
struct OfflineRow {
    id: Uuid,
    status: String,
    payment_method: Option<String>,
    deposit_cents: i64,
    contract_accepted_at: Option<DateTime<Utc>>,
    emails_muted: bool,
    online_booking_enabled: bool,
    pay_cheque_enabled: bool,
    pay_virement_enabled: bool,
    instructions_cheque: String,
    instructions_virement: String,
    customer_email: Option<String>,
    customer_first_name: Option<String>,
    customer_locale: Option<String>,
    translations: serde_json::Value,
}

/// Réservation en ligne réglée hors carte (chèque ou virement) : la semaine est
/// tenue (statut `pending_payment`) et le client reçoit les instructions de
/// règlement. La réservation ne devient définitive que lorsque l'admin pointe
/// l'acompte comme encaissé (mark-paid) ; sinon il annule et la semaine se
/// libère.
async fn reserve_offline(
    State(st): State<AppState>,
    headers: HeaderMap,
    Path(reference): Path<String>,
    Json(input): Json<ReserveOfflineInput>,
) -> Result<Json<serde_json::Value>, AppError> {
    // Unauthenticated: claims the week and e-mails the real customer. Throttle per IP so
    // guessed references can't be used to grief availability or spam notifications.
    st.rate.check(
        "reserve_offline",
        &rate::client_ip(&headers),
        20,
        std::time::Duration::from_secs(600),
    )?;
    if !["cheque", "virement"].contains(&input.method.as_str()) {
        return Err(AppError::BadRequest("Moyen de règlement invalide.".into()));
    }
    let b = sqlx::query_as::<_, OfflineRow>(
        "select b.id, b.status, b.payment_method, b.deposit_cents, b.contract_accepted_at, \
                b.emails_muted, \
                p.online_booking_enabled, p.pay_cheque_enabled, p.pay_virement_enabled, \
                p.instructions_cheque, p.instructions_virement, p.translations, \
                c.email as customer_email, c.first_name as customer_first_name, \
                c.locale as customer_locale \
         from booking b \
         join property p on p.id = b.property_id \
         left join customer c on c.id = b.customer_id \
         where b.reference = $1",
    )
    .bind(&reference)
    .fetch_optional(&st.pool)
    .await?
    .ok_or_else(|| AppError::NotFound("réservation".into()))?;

    // Idempotent : re-soumission du même choix → même réponse, pas de double e-mail.
    if b.status == "pending_payment" && b.payment_method.as_deref() == Some(&input.method) {
        return Ok(Json(
            serde_json::json!({ "status": "pending_payment", "reference": reference }),
        ));
    }
    if b.status != "cart" {
        return Err(AppError::BadRequest("Réservation déjà réglée.".into()));
    }
    if !b.online_booking_enabled {
        return Err(AppError::BadRequest(
            "La réservation en ligne est momentanément fermée. Contactez-nous directement.".into(),
        ));
    }
    let method_enabled = match input.method.as_str() {
        "cheque" => b.pay_cheque_enabled,
        _ => b.pay_virement_enabled,
    };
    if !method_enabled {
        return Err(AppError::BadRequest(
            "Ce moyen de règlement n'est pas proposé.".into(),
        ));
    }
    // Même garde légale que le paiement CB : contrat signé d'abord.
    if b.contract_accepted_at.is_none() {
        return Err(AppError::BadRequest(
            "Le contrat doit être signé avant de finaliser.".into(),
        ));
    }

    let mut tx = st.pool.begin().await?;
    if !try_claim_week(&mut tx, b.id).await? {
        return Err(AppError::BadRequest(
            "Cette semaine vient d'être réservée par quelqu'un d'autre.".into(),
        ));
    }
    // La caution suit le même canal : pas de carte → chèque de caution physique.
    sqlx::query(
        "update booking set status = 'pending_payment', payment_method = $2, \
            caution_method = 'cheque', updated_at = now() where id = $1",
    )
    .bind(b.id)
    .bind(&input.method)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;

    // Instructions de règlement (e-mail système personnalisable), sauf coupure.
    if scheduler::transactional_emails_enabled(&st.pool).await && !b.emails_muted {
        if let Some(to) = b.customer_email.clone().filter(|e| !e.trim().is_empty()) {
            let lang = i18n::Lang::from_param(b.customer_locale.as_deref());
            let instructions = match input.method.as_str() {
                "cheque" => i18n::tr_field(
                    &b.translations,
                    lang,
                    "instructionsCheque",
                    &b.instructions_cheque,
                ),
                _ => i18n::tr_field(
                    &b.translations,
                    lang,
                    "instructionsVirement",
                    &b.instructions_virement,
                ),
            };
            let instructions = if instructions.trim().is_empty() {
                match lang {
                    i18n::Lang::Fr => "Contactez-nous pour les modalités de règlement.".to_string(),
                    i18n::Lang::En => "Contact us for the payment details.".to_string(),
                }
            } else {
                instructions
            };
            let methode = match (input.method.as_str(), lang) {
                ("cheque", i18n::Lang::Fr) => "chèque".to_string(),
                ("cheque", i18n::Lang::En) => "cheque".to_string(),
                (_, i18n::Lang::Fr) => "virement bancaire".to_string(),
                (_, i18n::Lang::En) => "bank transfer".to_string(),
            };
            let vars = vec![
                (
                    "bonjour",
                    email::bonjour_lang(b.customer_first_name.as_deref(), lang),
                ),
                ("prenom", b.customer_first_name.clone().unwrap_or_default()),
                ("reference", reference.clone()),
                ("montant", i18n::eur(b.deposit_cents, lang)),
                ("methode", methode),
                ("instructions", instructions),
            ];
            let pool = st.pool.clone();
            let bid = b.id;
            tokio::spawn(async move {
                let _ = email::send_system(
                    pool,
                    Some(bid),
                    "offline_pending",
                    to,
                    &vars,
                    &format!("{}/espace", email::front_url_lang(lang)),
                    lang,
                )
                .await;
            });
        }
    }

    Ok(Json(
        serde_json::json!({ "status": "pending_payment", "reference": reference }),
    ))
}

#[derive(FromRow)]
struct ConfirmRow {
    id: Uuid,
    status: String,
    deposit_intent_id: Option<String>,
    customer_id: Option<Uuid>,
}

/// Confirm the deposit once the buyer has paid: reads the intent from the
/// provider (Stripe status, or always-paid for mock), marks the booking, and
/// opens a customer session (cookie) for the espace client.
/// Try to claim a booking's week atomically, inside `tx`.
/// - `Ok(true)`  → the week is now held by this booking (safe to confirm). Also
///   returned when the week is unclaimable for a reason *other* than a rival
///   confirmed booking (idempotent re-confirm, admin-blocked week).
/// - `Ok(false)` → a *different* confirmed/balance_paid booking already holds the
///   week: the caller must NOT confirm and should refund the deposit.
///
/// Shared by the synchronous confirm and the Stripe webhook so both enforce the
/// same anti-double-booking guard.
async fn try_claim_week(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    booking_id: Uuid,
) -> Result<bool, AppError> {
    let claimed = sqlx::query(
        "update availability_week set status = 'booked' \
         where id = (select week_id from booking where id = $1) and status = 'available'",
    )
    .bind(booking_id)
    .execute(&mut **tx)
    .await?;
    if claimed.rows_affected() > 0 {
        return Ok(true);
    }
    // The week wasn't 'available'. Confirming is safe ONLY if it's already 'booked' and
    // no *other* active booking holds it — i.e. an idempotent re-claim by this same
    // booking (e.g. a concurrent double-tap that just claimed it). A 'blocked' week
    // (admin or iCal) is NOT bookable: confirming would strand a confirmed booking on a
    // blocked week and later trip the `booking_one_active_per_week` index (500 + orphan
    // deposit). Treat any non-'booked' state as taken → caller refunds the deposit.
    let claimable: Option<i32> = sqlx::query_scalar(
        "select 1 from availability_week w \
         where w.id = (select week_id from booking where id = $1) \
           and w.status = 'booked' \
           and not exists ( \
             select 1 from booking b2 \
             where b2.week_id = w.id and b2.id <> $1 \
               and b2.status in ('confirmed', 'balance_paid')) \
         limit 1",
    )
    .bind(booking_id)
    .fetch_optional(&mut **tx)
    .await?;
    Ok(claimable.is_some())
}

/// Loser of a double-booking race: the buyer's deposit succeeded but the week was
/// claimed by someone else. Refund the deposit (idempotent key) and void the cart so
/// nothing lingers and the promise "votre acompte vous sera remboursé" is kept.
async fn refund_lost_deposit(st: &AppState, booking_id: Uuid, intent_id: &str) {
    let outcome: Result<(), AppError> = async {
        let amount: i64 = sqlx::query_scalar(
            "select amount_cents from payment \
             where booking_id = $1 and type = 'deposit' order by created_at desc limit 1",
        )
        .bind(booking_id)
        .fetch_one(&st.pool)
        .await?;
        let refund_id = st
            .payments
            .refund(intent_id, amount, &format!("refund-lost-{intent_id}"))
            .await?;
        let mut tx = st.pool.begin().await?;
        sqlx::query(
            "update payment set status = 'succeeded', updated_at = now() \
             where booking_id = $1 and type = 'deposit'",
        )
        .bind(booking_id)
        .execute(&mut *tx)
        .await?;
        sqlx::query(
            "insert into payment (booking_id, type, provider, provider_intent_id, amount_cents, status, raw) \
             values ($1, 'refund', $2, $3, $4, 'refunded', \
                     jsonb_build_object('source', 'deposit', 'origin', 'double_booking'))",
        )
        .bind(booking_id)
        .bind(st.payments.name())
        .bind(&refund_id)
        .bind(amount)
        .execute(&mut *tx)
        .await?;
        sqlx::query(
            "update booking set status = 'cancelled', cancelled_at = now(), \
                cancel_reason = 'Double réservation — acompte remboursé', updated_at = now() \
             where id = $1 and status <> 'cancelled'",
        )
        .bind(booking_id)
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
        Ok(())
    }
    .await;
    if let Err(e) = outcome {
        // Never lose the signal: if the auto-refund fails, an admin must act.
        tracing::error!(
            "ÉCHEC remboursement acompte perdu (booking {booking_id}, intent {intent_id}): {e:?}"
        );
    }
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct ConfirmDepositInput {
    /// The deposit PaymentIntent client_secret, returned to the buyer's browser by
    /// `pay-deposit`. Presenting it proves the caller initiated this payment and gates
    /// issuance of the session cookie: the booking reference alone is public (it appears
    /// in e-mails, URLs and `get_booking`), so without this a session could be minted for
    /// anyone's confirmed booking from its reference (account takeover).
    client_secret: Option<String>,
}

/// True when `provided` is the client_secret of the deposit intent. Stripe secrets are
/// `{intent_id}_secret_{random}`, the mock's are `{intent_id}_secret`; both begin with
/// `{intent_id}_secret`. The intent id is never exposed publicly, so the prefix suffices.
fn deposit_secret_matches(provided: &Option<String>, intent_id: &Option<String>) -> bool {
    match (provided, intent_id) {
        (Some(cs), Some(id)) if !id.is_empty() => cs.starts_with(&format!("{id}_secret")),
        _ => false,
    }
}

async fn confirm_deposit(
    State(st): State<AppState>,
    Path(reference): Path<String>,
    body: Option<Json<ConfirmDepositInput>>,
) -> Result<Response, AppError> {
    let provided_secret = body.map(|Json(b)| b.client_secret).unwrap_or_default();
    let b = sqlx::query_as::<_, ConfirmRow>(
        "select id, status, deposit_intent_id, customer_id from booking where reference = $1",
    )
    .bind(&reference)
    .fetch_optional(&st.pool)
    .await?
    .ok_or_else(|| AppError::NotFound("réservation".into()))?;

    // Only ever set the session cookie for a caller who proves they initiated this
    // deposit by presenting its client_secret — never on the reference alone.
    let authed = deposit_secret_matches(&provided_secret, &b.deposit_intent_id);

    // Idempotent / terminal states: only a still-pending cart is confirmed here.
    // Re-confirming an already-confirmed booking would resend the welcome e-mail and
    // regress its status; a cancelled one (e.g. the loser of a double-booking already
    // handled by the webhook) must NOT be refunded again (duplicate refund line).
    match b.status.as_str() {
        // Idempotent: re-establish the session cookie (so a lost-response retry still
        // logs the buyer in) but don't re-run the claim or re-send the welcome e-mail.
        "confirmed" | "balance_paid" => {
            return confirmed_session_response(&st, &reference, b.customer_id, authed).await
        }
        "cancelled" => {
            return Err(AppError::BadRequest(
                "Cette semaine a été réservée par un autre client ; votre acompte a été remboursé."
                    .into(),
            ))
        }
        _ => {}
    }

    let intent_id = b
        .deposit_intent_id
        .ok_or_else(|| AppError::BadRequest("Aucun paiement initié.".into()))?;

    let result = st.payments.retrieve_deposit(&intent_id).await?;
    if !result.paid {
        return Err(AppError::BadRequest("Paiement non confirmé.".into()));
    }

    let mut tx = st.pool.begin().await?;
    // Atomically claim the week; refuse if another confirmed booking already holds it.
    if !try_claim_week(&mut tx, b.id).await? {
        drop(tx); // release the (no-op) claim tx before refunding
        refund_lost_deposit(&st, b.id, &intent_id).await;
        return Err(AppError::BadRequest(
            "Cette semaine vient d'être réservée par un autre client. Votre acompte vous sera remboursé.".into(),
        ));
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

    // Fresh confirmation: open the session (cookie) and send the welcome e-mail once.
    let resp = confirmed_session_response(&st, &reference, b.customer_id, authed).await?;
    if let Some(cid) = b.customer_id {
        send_welcome_email(&st.pool, b.id, cid, &reference).await;
    }
    Ok(resp)
}

/// Booking JSON + a fresh customer-session cookie (when the booking has a customer).
/// Shared by the fresh confirm and the idempotent re-confirm so both log the buyer in.
async fn confirmed_session_response(
    st: &AppState,
    reference: &str,
    customer_id: Option<Uuid>,
    set_session: bool,
) -> Result<Response, AppError> {
    let dto = fetch_booking(&st.pool, reference).await?;
    let mut resp = Json(dto).into_response();
    // Only mint the session cookie when the caller proved ownership of the deposit
    // (see `confirm_deposit`). Otherwise return the booking JSON alone — the buyer can
    // still reach /espace via the magic link in the welcome e-mail.
    if set_session {
        if let Some(cid) = customer_id {
            let token = create_customer_session(&st.pool, cid).await?;
            resp.headers_mut().insert(
                header::SET_COOKIE,
                HeaderValue::from_str(&session_cookie(&token))
                    .map_err(|_| AppError::Internal("cookie".into()))?,
            );
        }
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
/// Whether the API runs in a production context. `APP_ENV=production` is the
/// explicit signal; `COOKIE_SECURE=true` (set by the prod compose) is accepted as
/// a fallback so an existing deployment is covered without a new variable.
pub(crate) fn is_production() -> bool {
    matches!(env::var("APP_ENV").as_deref(), Ok("production"))
        || matches!(env::var("COOKIE_SECURE").as_deref(), Ok("true") | Ok("1"))
}

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
pub(crate) async fn send_welcome_email(
    pool: &PgPool,
    booking_id: Uuid,
    cid: Uuid,
    reference: &str,
) {
    // E-mails automatiques coupés (globalement ou pour ce dossier) → silence.
    if !scheduler::transactional_emails_enabled(pool).await {
        return;
    }
    let muted: bool = sqlx::query_scalar("select emails_muted from booking where id = $1")
        .bind(booking_id)
        .fetch_one(pool)
        .await
        .unwrap_or(false);
    if muted {
        return;
    }
    let cust: Option<(String, String, String)> =
        sqlx::query_as("select email, first_name, locale from customer where id = $1")
            .bind(cid)
            .fetch_optional(pool)
            .await
            .ok()
            .flatten();
    let Some((mail, first_name, locale)) = cust else {
        return;
    };
    if mail.trim().is_empty() {
        return;
    }
    let lang = i18n::Lang::from_param(Some(&locale));
    let link = match create_magic_token(pool, cid).await {
        Ok(t) => format!("{}/api/espace/login?token={}", email::api_url(), t),
        Err(_) => format!("{}/espace", email::front_url_lang(lang)),
    };
    let vars = vec![
        ("bonjour", email::bonjour_lang(Some(&first_name), lang)),
        ("prenom", first_name.clone()),
        ("reference", reference.to_string()),
    ];
    let _ = email::send_system(
        pool.clone(),
        Some(booking_id),
        "welcome",
        mail,
        &vars,
        &link,
        lang,
    )
    .await;
}

#[derive(Deserialize)]
struct RequestLinkBody {
    email: String,
}

/// Ask for a magic login link. Always 204 (never leaks whether the e-mail exists).
async fn request_link(
    State(st): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<RequestLinkBody>,
) -> Result<StatusCode, AppError> {
    // Anti-abuse: cap magic-link e-mails per client IP (prevents mail-bombing).
    st.rate.check(
        "request-link",
        &rate::client_ip(&headers),
        5,
        std::time::Duration::from_secs(600),
    )?;

    let email_in = body.email.trim().to_string();
    if !email_in.is_empty() {
        let row: Option<(Uuid, String)> = sqlx::query_as(
            "select id, locale from customer where lower(email) = lower($1) order by created_at desc limit 1",
        )
        .bind(&email_in)
        .fetch_optional(&st.pool)
        .await?;
        if let Some((cid, locale)) = row {
            let lang = i18n::Lang::from_param(Some(&locale));
            let token = create_magic_token(&st.pool, cid).await?;
            let link = format!("{}/api/espace/login?token={}", email::api_url(), token);
            let (site, location) = email::brand(&st.pool).await;
            let (heading, body, cta, subject) = match lang {
                i18n::Lang::Fr => (
                    "Connexion à votre espace",
                    "Cliquez ci-dessous pour accéder à votre espace séjour. Ce lien est valable 30 minutes.",
                    "Ouvrir mon espace",
                    format!("Connexion à votre espace — {site}"),
                ),
                i18n::Lang::En => (
                    "Sign in to your account",
                    "Click below to access your stay account. This link is valid for 30 minutes.",
                    "Open my account",
                    format!("Sign in to your account — {site}"),
                ),
            };
            let html = email::template_lang(&site, &location, heading, body, cta, &link, lang);
            email::spawn(st.pool.clone(), None, "magic_link", email_in, subject, html);
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
    // Le client anglophone atterrit sur la version anglaise de son espace.
    let locale: String = sqlx::query_scalar("select locale from customer where id = $1")
        .bind(cid)
        .fetch_optional(&st.pool)
        .await?
        .unwrap_or_else(|| "fr".into());
    let prefix = if locale == "en" { "/en" } else { "" };
    let token = create_customer_session(&st.pool, cid).await?;
    let mut resp = redirect(format!("{front}{prefix}/espace"))?;
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
    tourist_tax_cents: i64,
    /// The balance can be settled online now (confirmed, unpaid, not disputed).
    balance_payable: bool,
    /// A previous automatic charge failed (dunning) — surfaced to the client.
    balance_failed: bool,
    /// Jeton du contrat signé — le front construit /contrat/{token} (copie).
    contract_token: Option<String>,
    created_at: DateTime<Utc>,
    /// Pour recalculer les libellés dans une autre langue — jamais sérialisé.
    #[serde(skip)]
    end_date: NaiveDate,
}

#[derive(Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
struct MePropertyDto {
    name: String,
    location_label: String,
    arrival_instructions: String,
    house_rules: String,
    #[serde(skip)]
    translations: serde_json::Value,
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
    Query(q): Query<LocaleQuery>,
) -> Result<Json<MeResponse>, AppError> {
    let lang = i18n::Lang::from_param(q.locale.as_deref());
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

    // Copie du contrat : les dossiers signés au checkout (web) n'ont pas de
    // jeton — on le crée paresseusement pour que chaque client retrouve son
    // contrat depuis l'espace, comme les dossiers manuels signés par lien.
    let missing: Vec<Uuid> = sqlx::query_scalar(
        "select id from booking \
         where customer_id = $1 and contract_accepted_at is not null \
           and contract_sign_token is null and status in ('confirmed','balance_paid')",
    )
    .bind(cid)
    .fetch_all(&st.pool)
    .await?;
    for id in missing {
        sqlx::query("update booking set contract_sign_token = $2 where id = $1")
            .bind(id)
            .bind(admin::new_token())
            .execute(&st.pool)
            .await?;
    }

    let mut bookings = sqlx::query_as::<_, MyBookingDto>(
        "select b.reference, b.status, aw.range_label as week_range, aw.arrival_label as arrival, \
                aw.start_date, b.total_cents, b.deposit_cents, b.balance_cents, b.caution_cents, \
                b.deposit_paid_at, b.balance_paid_at, b.caution_authorized_at, b.cancelled_at, \
                b.tourist_tax_cents, \
                (b.status = 'confirmed' and b.balance_paid_at is null and b.balance_cents > 0 \
                    and b.payment_flag is null) as balance_payable, \
                (b.balance_attempts > 0 and b.balance_paid_at is null) as balance_failed, \
                case when b.contract_accepted_at is not null \
                      and b.status in ('confirmed','balance_paid') \
                     then b.contract_sign_token end as contract_token, \
                b.created_at, aw.end_date \
         from booking b join availability_week aw on aw.id = b.week_id \
         where b.customer_id = $1 order by aw.start_date desc",
    )
    .bind(cid)
    .fetch_all(&st.pool)
    .await?;

    if lang != i18n::Lang::Fr {
        for b in &mut bookings {
            b.week_range = i18n::range_label(b.start_date, b.end_date, lang);
            b.arrival = i18n::arrival_full(b.start_date, lang);
        }
    }

    let mut property = sqlx::query_as::<_, MePropertyDto>(
        "select distinct p.name, p.location_label, p.arrival_instructions, p.house_rules, \
                p.translations \
         from property p \
         join availability_week aw on aw.property_id = p.id \
         join booking b on b.week_id = aw.id \
         where b.customer_id = $1 limit 1",
    )
    .bind(cid)
    .fetch_optional(&st.pool)
    .await?;

    // Consignes d'arrivée / règlement intérieur traduits si disponibles.
    if lang != i18n::Lang::Fr {
        if let Some(p) = property.as_mut() {
            p.arrival_instructions = i18n::tr_field(
                &p.translations,
                lang,
                "arrivalInstructions",
                &p.arrival_instructions,
            );
            p.house_rules = i18n::tr_field(&p.translations, lang, "houseRules", &p.house_rules);
            p.location_label =
                i18n::tr_field(&p.translations, lang, "locationLabel", &p.location_label);
        }
    }

    Ok(Json(MeResponse {
        customer,
        property,
        bookings,
    }))
}

/// Resolve the logged-in customer from the `csession` cookie, or 401.
async fn csession_customer(st: &AppState, headers: &HeaderMap) -> Result<Uuid, AppError> {
    let token = headers
        .get(header::COOKIE)
        .and_then(|v| v.to_str().ok())
        .and_then(parse_csession)
        .ok_or(AppError::Unauthorized)?;
    sqlx::query_scalar(
        "select customer_id from customer_session where token = $1 and expires_at > now()",
    )
    .bind(&token)
    .fetch_optional(&st.pool)
    .await?
    .ok_or(AppError::Unauthorized)
}

#[derive(FromRow)]
struct BalancePayRow {
    id: Uuid,
    customer_id: Option<Uuid>,
    status: String,
    balance_cents: i64,
    balance_paid_at: Option<DateTime<Utc>>,
    payment_flag: Option<String>,
    provider_customer_id: Option<String>,
    balance_intent_id: Option<String>,
}

async fn load_owned_booking(
    st: &AppState,
    headers: &HeaderMap,
    reference: &str,
) -> Result<BalancePayRow, AppError> {
    let cid = csession_customer(st, headers).await?;
    let b = sqlx::query_as::<_, BalancePayRow>(
        "select id, customer_id, status, balance_cents, balance_paid_at, payment_flag, \
                provider_customer_id, balance_intent_id \
         from booking where reference = $1",
    )
    .bind(reference)
    .fetch_optional(&st.pool)
    .await?
    .ok_or_else(|| AppError::NotFound("réservation".into()))?;
    if b.customer_id != Some(cid) {
        return Err(AppError::Unauthorized);
    }
    Ok(b)
}

/// Fallback online balance payment (on-session, so 3DS/SCA is handled in-browser)
/// for a customer whose automatic off-session charge failed. Auth via csession.
async fn pay_balance(
    State(st): State<AppState>,
    headers: HeaderMap,
    Path(reference): Path<String>,
) -> Result<Json<PayDepositResponse>, AppError> {
    let b = load_owned_booking(&st, &headers, &reference).await?;

    if b.balance_paid_at.is_some() {
        return Err(AppError::BadRequest("Le solde est déjà réglé.".into()));
    }
    if b.status != "confirmed" || b.balance_cents <= 0 {
        return Err(AppError::BadRequest(
            "Aucun solde à régler pour cette réservation.".into(),
        ));
    }
    if b.payment_flag.is_some() {
        return Err(AppError::BadRequest(
            "Cette réservation est en cours de traitement (remboursement ou litige).".into(),
        ));
    }

    let provider = st.payments.name().to_string();

    // Lock the booking row and re-check the balance isn't already settled *inside* the
    // lock before creating an intent: the off-session scheduler charge takes the same
    // FOR UPDATE lock and re-checks too, so an on-session and an off-session charge can
    // never both fire (two distinct intents → two real debits). Whoever commits first wins.
    let mut tx = st.pool.begin().await?;
    let already_paid: Option<DateTime<Utc>> =
        sqlx::query_scalar("select balance_paid_at from booking where id = $1 for update")
            .bind(b.id)
            .fetch_one(&mut *tx)
            .await?;
    if already_paid.is_some() {
        return Err(AppError::BadRequest("Le solde est déjà réglé.".into()));
    }
    let intent = st
        .payments
        .create_balance_intent(
            &reference,
            b.balance_cents,
            b.provider_customer_id.as_deref(),
        )
        .await?;
    sqlx::query(
        "insert into payment (booking_id, type, provider, provider_intent_id, amount_cents, status) \
         values ($1, 'balance', $2, $3, $4, 'pending')",
    )
    .bind(b.id)
    .bind(&provider)
    .bind(&intent.intent_id)
    .bind(b.balance_cents)
    .execute(&mut *tx)
    .await?;
    sqlx::query("update booking set balance_intent_id = $2, updated_at = now() where id = $1")
        .bind(b.id)
        .bind(&intent.intent_id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;

    Ok(Json(PayDepositResponse {
        provider,
        client_secret: intent.client_secret,
        publishable_key: st.payments.publishable_key(),
        deposit_cents: b.balance_cents,
    }))
}

/// Confirm a fallback balance payment once the buyer completed it in the browser.
async fn confirm_balance(
    State(st): State<AppState>,
    headers: HeaderMap,
    Path(reference): Path<String>,
) -> Result<StatusCode, AppError> {
    let b = load_owned_booking(&st, &headers, &reference).await?;
    if b.balance_paid_at.is_some() {
        return Ok(StatusCode::NO_CONTENT); // idempotent
    }
    let intent_id = b
        .balance_intent_id
        .ok_or_else(|| AppError::BadRequest("Aucun paiement de solde en cours.".into()))?;

    let result = st.payments.retrieve_deposit(&intent_id).await?;
    if !result.paid {
        return Err(AppError::BadRequest("Paiement non finalisé.".into()));
    }

    settle_balance(&st.pool, b.id, &intent_id).await?;
    Ok(StatusCode::NO_CONTENT)
}

/// Mark a booking's balance as paid (idempotent). Shared by the online fallback
/// confirm and the Stripe webhook.
async fn settle_balance(pool: &PgPool, booking_id: Uuid, intent_id: &str) -> Result<(), AppError> {
    let mut tx = pool.begin().await?;
    sqlx::query(
        "update payment set status = 'succeeded', updated_at = now() \
         where provider_intent_id = $1",
    )
    .bind(intent_id)
    .execute(&mut *tx)
    .await?;
    // Never resurrect a cancelled/expired booking: a balance payment that lands after
    // the admin cancelled (client finished 3DS post-cancel, or a replayed webhook) must
    // not flip it back to 'balance_paid' — that would strand a zombie booking and can
    // violate `booking_one_active_per_week` if the week was re-let (→ 500 + webhook
    // retry loop). The payment row above still records the real charge for admin refund.
    sqlx::query(
        "update booking set status = 'balance_paid', balance_paid_at = coalesce(balance_paid_at, now()), \
            balance_last_error = null, updated_at = now() \
         where id = $1 and balance_paid_at is null and status not in ('cancelled', 'expired')",
    )
    .bind(booking_id)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(())
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
    // Anti-replay: reject events whose signed timestamp is outside Stripe's recommended
    // 5-minute tolerance, so a captured signed payload can't be replayed later (e.g. to
    // re-clear a `disputed` flag via a stale `charge.dispute.closed`).
    let Ok(ts) = t.parse::<i64>() else {
        return false;
    };
    if (chrono::Utc::now().timestamp() - ts).abs() > 300 {
        return false;
    }
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
    match env::var("STRIPE_WEBHOOK_SECRET")
        .ok()
        .filter(|s| !s.is_empty())
    {
        Some(secret) => {
            let sig = headers
                .get("stripe-signature")
                .and_then(|v| v.to_str().ok())
                .unwrap_or_default();
            if !verify_stripe_signature(&body, sig, &secret) {
                return Err(AppError::BadRequest("Signature webhook invalide.".into()));
            }
        }
        None => {
            // Fail closed: if Stripe is the live provider, an unsigned webhook must
            // never be trusted (it could confirm a booking without real payment).
            // Only the mock/dev provider accepts unsigned events.
            if payments::stripe_active() {
                tracing::error!(
                    "webhook rejeté : STRIPE_WEBHOOK_SECRET absent alors que Stripe est actif"
                );
                return Err(AppError::BadRequest("Webhook non vérifiable.".into()));
            }
        }
    }

    let event: serde_json::Value = serde_json::from_slice(&body)
        .map_err(|_| AppError::BadRequest("Payload webhook invalide.".into()))?;
    let kind = event
        .get("type")
        .and_then(|t| t.as_str())
        .unwrap_or_default();

    let obj = &event["data"]["object"];
    match kind {
        "payment_intent.succeeded" => confirm_from_webhook(&st, obj).await?,
        "payment_intent.payment_failed" | "payment_intent.canceled" => {
            let intent_id = obj.get("id").and_then(|v| v.as_str()).unwrap_or_default();
            if !intent_id.is_empty() {
                sqlx::query(
                    "update payment set status = 'failed', updated_at = now() \
                     where provider_intent_id = $1 and status in ('pending', 'authorized')",
                )
                .bind(intent_id)
                .execute(&st.pool)
                .await?;
                tracing::warn!("webhook: paiement échoué/annulé (intent {intent_id}, {kind})");
            }
        }
        "charge.refunded" => {
            // Stripe raises charge.refunded for EVERY refund on the charge, including
            // the ones we initiate from the admin (which already recorded their own
            // 'refund' row). Reconcile by amount so our own refunds are not double-
            // counted or wrongly flagged: only the still-unaccounted delta is a
            // genuinely external (dashboard) refund → record it and flag the booking.
            let pi = obj.get("payment_intent").and_then(|v| v.as_str());
            let refunded_total = obj
                .get("amount_refunded")
                .and_then(|v| v.as_i64())
                .unwrap_or(0);
            if let Some(intent_id) = pi.filter(|s| !s.is_empty()) {
                reconcile_external_refund(&st, intent_id, refunded_total).await?;
            }
        }
        "charge.dispute.created" | "charge.dispute.funds_withdrawn" => {
            let pi = obj.get("payment_intent").and_then(|v| v.as_str());
            if let Some(intent_id) = pi.filter(|s| !s.is_empty()) {
                flag_booking_by_intent(&st, intent_id, "disputed").await?;
                tracing::error!(
                    "webhook: LITIGE Stripe ouvert (intent {intent_id}) — action admin requise"
                );
            }
        }
        "charge.dispute.closed" => {
            // Dispute resolved in our favour → lift the 'disputed' block so the file
            // is operable again (scheduler + client balance payment). A lost dispute
            // stays flagged for admin attention.
            let pi = obj.get("payment_intent").and_then(|v| v.as_str());
            let won = obj.get("status").and_then(|v| v.as_str()) == Some("won");
            if let Some(intent_id) = pi.filter(|s| !s.is_empty()) {
                if won {
                    clear_flag_by_intent(&st, intent_id, "disputed").await?;
                    tracing::info!("webhook: litige gagné (intent {intent_id}) — blocage levé");
                } else {
                    tracing::warn!("webhook: litige clos non gagné (intent {intent_id})");
                }
            }
        }
        other => {
            tracing::debug!("webhook: event ignoré ({other})");
        }
    }

    Ok(StatusCode::OK)
}

/// Flag a booking (matched by any of its intent ids) for admin attention and stop
/// the scheduler from charging it further.
async fn flag_booking_by_intent(
    st: &AppState,
    intent_id: &str,
    flag: &str,
) -> Result<(), AppError> {
    sqlx::query(
        "update booking set payment_flag = $2, flagged_at = now(), updated_at = now() \
         where (deposit_intent_id = $1 or balance_intent_id = $1 or caution_intent_id = $1) \
           and payment_flag is null",
    )
    .bind(intent_id)
    .bind(flag)
    .execute(&st.pool)
    .await?;
    Ok(())
}

/// Clear a specific `flag` on the booking matched by any of its intent ids (e.g. a
/// dispute resolved in our favour). Only clears if the current flag matches, so a
/// later/other flag isn't wiped.
async fn clear_flag_by_intent(st: &AppState, intent_id: &str, flag: &str) -> Result<(), AppError> {
    sqlx::query(
        "update booking set payment_flag = null, flagged_at = null, updated_at = now() \
         where (deposit_intent_id = $1 or balance_intent_id = $1 or caution_intent_id = $1) \
           and payment_flag = $2",
    )
    .bind(intent_id)
    .bind(flag)
    .execute(&st.pool)
    .await?;
    Ok(())
}

/// Reconcile a `charge.refunded` event against the refunds we already recorded.
/// `refunded_total` is Stripe's cumulative amount refunded on the charge; we only
/// act on the part not already covered by our own admin-initiated 'refund' rows —
/// that delta is a genuinely external (dashboard) refund, which we record and flag.
async fn reconcile_external_refund(
    st: &AppState,
    intent_id: &str,
    refunded_total: i64,
) -> Result<(), AppError> {
    // Which booking + source (deposit/balance) does this charge back?
    let row: Option<(Uuid, String)> = sqlx::query_as(
        "select booking_id, type from payment \
         where provider_intent_id = $1 and type in ('deposit', 'balance') limit 1",
    )
    .bind(intent_id)
    .fetch_optional(&st.pool)
    .await?;
    let Some((booking_id, source)) = row else {
        return Ok(()); // unknown/caution intent — nothing to reconcile
    };

    // Lock the booking first, inside the tx, so this serializes with a concurrent
    // admin refund (perform_refund also locks it): we then read `recorded` AFTER that
    // refund committed, so our own refund isn't miscounted as an external one (which
    // would insert a phantom refund line + wrongly flag the booking).
    let mut tx = st.pool.begin().await?;
    sqlx::query("select id from booking where id = $1 for update")
        .bind(booking_id)
        .execute(&mut *tx)
        .await?;

    let recorded: i64 = sqlx::query_scalar(
        "select coalesce(sum(amount_cents), 0)::bigint from payment \
         where booking_id = $1 and type = 'refund' and raw->>'source' = $2",
    )
    .bind(booking_id)
    .bind(&source)
    .fetch_one(&mut *tx)
    .await?;

    let delta = refunded_total - recorded;
    if delta <= 0 {
        return Ok(()); // fully accounted for by our own refund(s)
    }

    // Genuinely external refund of `delta`: record it and flag for admin attention
    // (the scheduler then skips this booking).
    sqlx::query(
        "insert into payment (booking_id, type, provider, amount_cents, status, raw) \
         values ($1, 'refund', 'stripe', $2, 'refunded', \
                 jsonb_build_object('source', $3::text, 'origin', 'dashboard'))",
    )
    .bind(booking_id)
    .bind(delta)
    .bind(&source)
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        "update booking set payment_flag = coalesce(payment_flag, 'refunded_externally'), \
            flagged_at = coalesce(flagged_at, now()), updated_at = now() where id = $1",
    )
    .bind(booking_id)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    tracing::warn!("webhook: remboursement externe de {delta}c (intent {intent_id}, {source})");
    Ok(())
}

/// Confirm a deposit from a verified `payment_intent.succeeded` webhook.
async fn confirm_from_webhook(st: &AppState, pi: &serde_json::Value) -> Result<(), AppError> {
    let intent_id = pi.get("id").and_then(|v| v.as_str()).unwrap_or_default();
    let customer = pi.get("customer").and_then(|v| v.as_str());
    let pm = pi.get("payment_method").and_then(|v| v.as_str());

    let mut tx = st.pool.begin().await?;
    // Payment is genuinely succeeded — record it regardless (idempotent).
    sqlx::query(
        "update payment set status = 'succeeded', updated_at = now() \
             where provider_intent_id = $1",
    )
    .bind(intent_id)
    .execute(&mut *tx)
    .await?;
    // Only a still-pending cart needs confirming (idempotent on re-delivery).
    let bid: Option<Uuid> = sqlx::query_scalar(
        "select id from booking where deposit_intent_id = $1 and status = 'cart'",
    )
    .bind(intent_id)
    .fetch_optional(&mut *tx)
    .await?;
    let mut lost: Option<Uuid> = None;
    if let Some(bid) = bid {
        // Same anti-double-booking guard as the synchronous confirm path.
        if try_claim_week(&mut tx, bid).await? {
            sqlx::query(
                "update booking set status = 'confirmed', \
                        deposit_paid_at = coalesce(deposit_paid_at, now()), \
                        provider_customer_id = coalesce(provider_customer_id, $2), \
                        provider_payment_method_id = coalesce(provider_payment_method_id, $3), \
                        updated_at = now() \
                     where id = $1",
            )
            .bind(bid)
            .bind(customer)
            .bind(pm)
            .execute(&mut *tx)
            .await?;
            tracing::info!("webhook: acompte confirmé (intent {intent_id})");
        } else {
            tracing::error!(
                "webhook: double-réservation évitée — acompte remboursé \
                     (intent {intent_id}, booking {bid})"
            );
            lost = Some(bid);
        }
    }
    tx.commit().await?;

    // Loser of the race: refund the deposit and void the cart (outside the tx).
    if let Some(bid) = lost {
        refund_lost_deposit(st, bid, intent_id).await;
    }

    // On-session balance payment (pay-balance fallback): settle idempotently so a
    // succeeded balance intent marks the booking balance_paid even without the
    // synchronous confirm-balance call.
    let balance_bid: Option<Uuid> = sqlx::query_scalar(
        "select id from booking where balance_intent_id = $1 and balance_paid_at is null",
    )
    .bind(intent_id)
    .fetch_optional(&st.pool)
    .await?;
    if let Some(bid) = balance_bid {
        settle_balance(&st.pool, bid, intent_id).await?;
        tracing::info!("webhook: solde réglé en ligne (intent {intent_id})");
    }
    Ok(())
}

fn verify_resend_signature(
    payload: &[u8],
    svix_id: &str,
    svix_timestamp: &str,
    svix_signature: &str,
    secret: &str,
) -> bool {
    use base64::prelude::*;
    use hmac::{Hmac, Mac};
    use sha2::Sha256;

    if svix_id.is_empty()
        || svix_timestamp.is_empty()
        || svix_signature.is_empty()
        || secret.is_empty()
    {
        return false;
    }

    let Ok(ts) = svix_timestamp.parse::<i64>() else {
        return false;
    };
    if (chrono::Utc::now().timestamp() - ts).abs() > 300 {
        return false;
    }

    let key = secret.strip_prefix("whsec_").unwrap_or(secret);
    let Ok(key) = BASE64_STANDARD.decode(key) else {
        return false;
    };

    let mut signed = Vec::with_capacity(svix_id.len() + svix_timestamp.len() + payload.len() + 2);
    signed.extend_from_slice(svix_id.as_bytes());
    signed.push(b'.');
    signed.extend_from_slice(svix_timestamp.as_bytes());
    signed.push(b'.');
    signed.extend_from_slice(payload);

    let Ok(mut mac) = Hmac::<Sha256>::new_from_slice(&key) else {
        return false;
    };
    mac.update(&signed);
    let expected = mac.finalize().into_bytes();

    svix_signature
        .split_whitespace()
        .filter_map(|part| part.split_once(','))
        .filter(|(version, _)| *version == "v1")
        .filter_map(|(_, sig)| BASE64_STANDARD.decode(sig).ok())
        .any(|sig| sig.len() == expected.len() && constant_time_eq(&sig, expected.as_slice()))
}

fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for (x, y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

/// Resend delivery webhook: enriches the email log with delivery/open/bounce
/// events. Matched by the Resend email id (provider_id). The signature must be
/// verified on the raw body before JSON parsing; Resend signs requests with Svix
/// headers (`svix-id`, `svix-timestamp`, `svix-signature`).
async fn resend_webhook(
    State(st): State<AppState>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<StatusCode, AppError> {
    let secret = env::var("RESEND_WEBHOOK_SECRET")
        .ok()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| {
            tracing::error!("RESEND_WEBHOOK_SECRET absent: webhook Resend refusé");
            AppError::BadRequest("Signature webhook invalide.".into())
        })?;
    let svix_id = headers
        .get("svix-id")
        .and_then(|v| v.to_str().ok())
        .unwrap_or_default();
    let svix_timestamp = headers
        .get("svix-timestamp")
        .and_then(|v| v.to_str().ok())
        .unwrap_or_default();
    let svix_signature = headers
        .get("svix-signature")
        .and_then(|v| v.to_str().ok())
        .unwrap_or_default();
    if !verify_resend_signature(&body, svix_id, svix_timestamp, svix_signature, &secret) {
        return Err(AppError::BadRequest("Signature webhook invalide.".into()));
    }

    let event: serde_json::Value = serde_json::from_slice(&body)
        .map_err(|_| AppError::BadRequest("Payload webhook invalide.".into()))?;
    let kind = event
        .get("type")
        .and_then(|t| t.as_str())
        .unwrap_or_default();
    let email_id = event
        .pointer("/data/email_id")
        .and_then(|v| v.as_str())
        .unwrap_or_default();
    if email_id.is_empty() {
        return Ok(StatusCode::OK);
    }
    let (event_kind, title, status) = match kind {
        "email.delivered" => ("email.delivered", "E-mail délivré", "delivered"),
        "email.opened" => ("email.opened", "E-mail ouvert", "opened"),
        "email.bounced" => ("email.bounced", "E-mail en échec", "bounced"),
        "email.complained" => ("email.complained", "Plainte e-mail", "complained"),
        _ => return Ok(StatusCode::OK),
    };

    // Map the event to a status; opened is terminal-best (don't downgrade to delivered).
    let row: Option<(Uuid, Option<Uuid>, String, String)> = match kind {
        "email.delivered" => sqlx::query_as(
            "update email_log set status = 'delivered', delivered_at = coalesce(delivered_at, now()) \
             where provider_id = $1 and status not in ('opened') \
             returning id, booking_id, subject, recipient",
        )
        .bind(email_id)
        .fetch_optional(&st.pool)
        .await?,
        "email.opened" => sqlx::query_as(
            "update email_log set status = 'opened', opened_at = coalesce(opened_at, now()), \
                    delivered_at = coalesce(delivered_at, now()) \
             where provider_id = $1 \
             returning id, booking_id, subject, recipient",
        )
        .bind(email_id)
        .fetch_optional(&st.pool)
        .await?,
        "email.bounced" | "email.complained" => sqlx::query_as(
            "update email_log set status = $2 where provider_id = $1 \
             returning id, booking_id, subject, recipient",
        )
        .bind(email_id)
        .bind(status)
        .fetch_optional(&st.pool)
        .await?,
        _ => None,
    };

    if let Some((email_log_id, Some(booking_id), subject, recipient)) = row {
        sqlx::query(
            "insert into booking_event (booking_id, kind, title, detail, email_log_id) \
             values ($1, $2, $3, $4, $5) \
             on conflict (email_log_id, kind) where email_log_id is not null do nothing",
        )
        .bind(booking_id)
        .bind(event_kind)
        .bind(title)
        .bind(format!("{subject} · {recipient}"))
        .bind(email_log_id)
        .execute(&st.pool)
        .await?;
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

#[cfg(test)]
mod tests {
    use super::*;
    use hmac::{Hmac, Mac};
    use sha2::Sha256;

    fn sign(payload: &[u8], t: &str, secret: &str) -> String {
        let signed = format!("{t}.{}", std::str::from_utf8(payload).unwrap());
        let mut mac = Hmac::<Sha256>::new_from_slice(secret.as_bytes()).unwrap();
        mac.update(signed.as_bytes());
        hex::encode(mac.finalize().into_bytes())
    }

    fn sign_resend(payload: &[u8], id: &str, t: &str, secret: &str) -> String {
        use base64::prelude::*;

        let key = BASE64_STANDARD
            .decode(secret.strip_prefix("whsec_").unwrap())
            .unwrap();
        let mut signed = Vec::new();
        signed.extend_from_slice(id.as_bytes());
        signed.push(b'.');
        signed.extend_from_slice(t.as_bytes());
        signed.push(b'.');
        signed.extend_from_slice(payload);
        let mut mac = Hmac::<Sha256>::new_from_slice(&key).unwrap();
        mac.update(&signed);
        format!("v1,{}", BASE64_STANDARD.encode(mac.finalize().into_bytes()))
    }

    /// A current unix timestamp string (inside the anti-replay tolerance window).
    fn now_ts() -> String {
        chrono::Utc::now().timestamp().to_string()
    }

    #[test]
    fn accepts_a_valid_signature() {
        let payload = br#"{"type":"payment_intent.succeeded"}"#;
        let secret = "whsec_test";
        let t = now_ts();
        let v1 = sign(payload, &t, secret);
        let header = format!("t={t},v1={v1}");
        assert!(verify_stripe_signature(payload, &header, secret));
    }

    #[test]
    fn accepts_a_valid_resend_signature() {
        let payload = br#"{"type":"email.delivered","data":{"email_id":"email_123"}}"#;
        let secret = "whsec_c2VjcmV0X3Rlc3Rfa2V5";
        let id = "msg_test";
        let t = now_ts();
        let signature = sign_resend(payload, id, &t, secret);
        assert!(verify_resend_signature(payload, id, &t, &signature, secret));
    }

    #[test]
    fn rejects_invalid_or_stale_resend_signature() {
        let payload = br#"{"type":"email.delivered","data":{"email_id":"email_123"}}"#;
        let secret = "whsec_c2VjcmV0X3Rlc3Rfa2V5";
        let id = "msg_test";
        let t = now_ts();
        let signature = sign_resend(payload, id, &t, secret);
        assert!(!verify_resend_signature(
            br#"{"type":"email.opened","data":{"email_id":"email_123"}}"#,
            id,
            &t,
            &signature,
            secret,
        ));
        assert!(!verify_resend_signature(
            payload, id, "1", &signature, secret,
        ));
    }

    #[test]
    fn rejects_wrong_secret_or_tampered_payload() {
        let payload = br#"{"amount":100}"#;
        let t = now_ts();
        let v1 = sign(payload, &t, "whsec_test");
        let header = format!("t={t},v1={v1}");
        // Wrong secret.
        assert!(!verify_stripe_signature(payload, &header, "whsec_other"));
        // Tampered payload, signature unchanged.
        assert!(!verify_stripe_signature(
            br#"{"amount":999}"#,
            &header,
            "whsec_test"
        ));
    }

    #[test]
    fn rejects_stale_timestamp_replay() {
        // A correctly-signed but old event must be rejected (replay protection).
        let payload = br#"{"type":"charge.dispute.closed"}"#;
        let secret = "whsec_test";
        let v1 = sign(payload, "1700000000", secret);
        let header = format!("t=1700000000,v1={v1}");
        assert!(!verify_stripe_signature(payload, &header, secret));
    }

    #[test]
    fn rejects_malformed_headers() {
        let payload = b"x";
        assert!(!verify_stripe_signature(payload, "", "whsec_test"));
        assert!(!verify_stripe_signature(
            payload,
            "v1=deadbeef",
            "whsec_test"
        )); // no t
        assert!(!verify_stripe_signature(
            payload,
            "t=1700000000",
            "whsec_test"
        )); // no v1
    }

    #[test]
    fn accepts_when_any_v1_matches() {
        // Stripe may send multiple v1 signatures during secret rotation.
        let payload = b"body";
        let t = now_ts();
        let good = sign(payload, &t, "whsec_test");
        let header = format!("t={t},v1=deadbeef,v1={good}");
        assert!(verify_stripe_signature(payload, &header, "whsec_test"));
    }
}
