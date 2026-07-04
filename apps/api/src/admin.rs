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
    routing::{delete, get, post, put},
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
        .route("/me", get(me).put(update_me))
        .route("/property/:slug", get(get_property).put(update_property))
        .route(
            "/property/:slug/translations",
            get(get_property_translations).put(update_property_translations),
        )
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
        .route("/contacts/:id", get(contact_detail).put(update_contact))
        .route("/contacts/:id/email", post(send_contact_email))
        .route("/contacts/:id/note", post(add_contact_note))
        .route(
            "/email-automations",
            get(list_email_automations).post(create_email_automation),
        )
        .route(
            "/email-automations/:id",
            put(update_email_automation).delete(delete_email_automation),
        )
        .route("/email-automations/preview", post(preview_email_automation))
        .route("/email-overrides", get(list_email_overrides))
        .route("/email-stats", get(email_stats))
        .route(
            "/email-overrides/:kind",
            put(upsert_email_override).delete(delete_email_override),
        )
        .route("/users", get(list_admin_users).post(create_admin_user))
        .route("/users/:id", delete(delete_admin_user))
        .route("/users/:id/reinvite", post(reinvite_admin_user))
        .route("/me/password", post(change_my_password))
        .route("/audit", get(list_audit))
        .route("/bookings/:reference/detail", get(booking_detail))
        .route("/bookings/:reference/clear-flag", post(clear_payment_flag))
        .route("/bookings/:reference/note", post(add_note))
        .route("/bookings/:reference/emails-muted", post(set_emails_muted))
        .route("/settings", get(get_settings).put(update_settings))
        .route(
            "/bookings/:reference/send-contract",
            post(send_contract_link),
        )
        .route("/bookings/:reference/email", post(send_booking_email))
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
        .route("/bookings/:reference/request-review", post(request_review))
        .route("/reviews", get(list_reviews))
        .route("/reviews/:id", put(update_review))
        .route("/property/:slug/ical", get(get_ical_url))
        .route(
            "/property/:slug/ical-feeds",
            get(list_ical_feeds).post(create_ical_feed),
        )
        .route("/ical-feeds/sync", post(sync_ical_feeds))
        .route("/ical-feeds/:id", delete(delete_ical_feed))
        .route("/scheduler/run", post(run_scheduler))
        .merge(crate::accounting::routes())
        .merge(crate::campaigns::routes())
        .layer(DefaultBodyLimit::max(12 * 1024 * 1024))
        .route_layer(middleware::from_fn_with_state(state.clone(), require_admin));

    Router::new()
        .route("/login", post(login))
        .route("/logout", post(logout))
        .route("/password/forgot", post(password_forgot))
        .route("/password/set", post(password_set))
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

pub(crate) fn new_token() -> String {
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
    display_name: String,
    email: String,
}

/// Journalise une action admin (fire-and-forget : l'audit ne doit jamais
/// bloquer ni faire échouer l'action elle-même).
fn audit(pool: sqlx::PgPool, admin_id: Uuid, admin_name: String, method: String, path: String) {
    tokio::spawn(async move {
        if let Err(e) = sqlx::query(
            "insert into admin_audit (admin_id, admin_name, method, path) values ($1, $2, $3, $4)",
        )
        .bind(admin_id)
        .bind(&admin_name)
        .bind(&method)
        .bind(&path)
        .execute(&pool)
        .await
        {
            tracing::warn!("audit admin: {e:?}");
        }
    });
}

fn booking_action_from_path(path: &str) -> Option<(String, String, String)> {
    let prefix = "/api/admin/bookings/";
    let rest = path.strip_prefix(prefix)?;
    let mut parts = rest.split('/');
    let reference = parts.next()?.trim();
    if reference.is_empty() || reference == "manual" {
        return None;
    }
    let action = parts.collect::<Vec<_>>().join("/");
    let (kind, title) = match action.as_str() {
        "clear-flag" => ("admin.clear_flag", "Blocage levé"),
        "note" => ("admin.note", "Note interne ajoutée"),
        "emails-muted" => ("admin.emails_muted", "Réglage e-mails modifié"),
        "send-contract" => ("admin.send_contract", "Contrat envoyé"),
        "email" => ("admin.email", "E-mail manuel envoyé"),
        "mark-paid" => ("admin.mark_paid", "Règlement pointé"),
        "cancel" => ("admin.cancel", "Réservation annulée"),
        "caution/capture" => ("admin.caution_capture", "Caution débitée"),
        "caution/release" => ("admin.caution_release", "Caution clôturée"),
        "refund" => ("admin.refund", "Remboursement enregistré"),
        "request-review" => ("admin.request_review", "Demande d'avis envoyée"),
        _ => return None,
    };
    Some((reference.to_string(), kind.to_string(), title.to_string()))
}

async fn booking_event_for_admin_action(
    pool: sqlx::PgPool,
    admin_id: Uuid,
    admin_name: String,
    path: String,
) {
    let Some((reference, kind, title)) = booking_action_from_path(&path) else {
        return;
    };
    if let Err(e) = sqlx::query(
        "insert into booking_event \
            (booking_id, kind, title, detail, actor_admin_id, actor_name) \
         select id, $2, $3, $4, $5, $6 from booking where reference = $1",
    )
    .bind(&reference)
    .bind(&kind)
    .bind(&title)
    .bind(Option::<String>::None)
    .bind(admin_id)
    .bind(&admin_name)
    .execute(&pool)
    .await
    {
        tracing::warn!("historique dossier: {e:?}");
    }
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
        "select s.admin_user_id, u.display_name, u.email \
         from admin_session s join admin_user u on u.id = s.admin_user_id \
         where s.token = $1 and s.expires_at > now()",
    )
    .bind(&token)
    .fetch_optional(&st.pool)
    .await?;

    match session {
        Some(s) => {
            req.extensions_mut().insert(AdminId(s.admin_user_id));
            // « Qui fait quoi » : toute action mutante réussie est attribuée
            // à son auteur (les GET, purement consultatifs, ne le sont pas).
            // POST de consultation (aperçu) : pas une action, pas d'audit.
            let mutating = !matches!(req.method(), &axum::http::Method::GET)
                && !req.uri().path().ends_with("/email-automations/preview");
            let method = req.method().to_string();
            let path = req.uri().path().to_string();
            let name = if s.display_name.is_empty() {
                s.email.clone()
            } else {
                s.display_name.clone()
            };
            let admin_id = s.admin_user_id;
            let pool = st.pool.clone();
            let res = next.run(req).await;
            if mutating && res.status().is_success() {
                audit(
                    pool.clone(),
                    admin_id,
                    name.clone(),
                    method.clone(),
                    path.clone(),
                );
                booking_event_for_admin_action(pool, admin_id, name, path).await;
            }
            Ok(res)
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
    /// Null tant que l'invitation n'a pas été acceptée (connexion impossible).
    password_hash: Option<String>,
    email: String,
    display_name: String,
    is_super: bool,
}

#[derive(Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
struct MeDto {
    id: Uuid,
    email: String,
    display_name: String,
    is_super: bool,
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
        "select id, password_hash, email, display_name, is_super from admin_user where email = $1",
    )
    .bind(input.email.trim().to_lowercase())
    .fetch_optional(&st.pool)
    .await?;

    let admin = match admin {
        Some(a)
            if a.password_hash
                .as_deref()
                .map(|h| verify_password(h, &input.password))
                .unwrap_or(false) =>
        {
            a
        }
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

    // Connexion tracée dans le journal (le middleware ne voit pas /login).
    audit(
        st.pool.clone(),
        admin.id,
        if admin.display_name.is_empty() {
            admin.email.clone()
        } else {
            admin.display_name.clone()
        },
        "LOGIN".into(),
        "/api/admin/login".into(),
    );

    let body = Json(MeDto {
        id: admin.id,
        email: admin.email,
        display_name: admin.display_name,
        is_super: admin.is_super,
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
    let dto = sqlx::query_as::<_, MeDto>(
        "select id, email, display_name, is_super from admin_user where id = $1",
    )
    .bind(id)
    .fetch_one(&st.pool)
    .await?;
    Ok(Json(dto))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateMeInput {
    display_name: String,
    email: String,
    /// Requis uniquement pour changer l'e-mail (identifiant de connexion).
    #[serde(default)]
    current_password: String,
}

/// Mise à jour de mon propre compte : nom affiché librement ; changement
/// d'e-mail confirmé par le mot de passe actuel (c'est l'identifiant de
/// connexion — on ne le change ni par accident ni depuis une session volée).
async fn update_me(
    State(st): State<AppState>,
    Extension(AdminId(id)): Extension<AdminId>,
    Json(body): Json<UpdateMeInput>,
) -> Result<Json<MeDto>, AppError> {
    let display_name = body.display_name.trim();
    let email = body.email.trim().to_lowercase();
    if display_name.is_empty() {
        return Err(AppError::BadRequest("Le nom affiché est requis.".into()));
    }
    if !email.contains('@') || !email.contains('.') {
        return Err(AppError::BadRequest("E-mail invalide.".into()));
    }
    let (current_email, hash): (String, Option<String>) =
        sqlx::query_as("select email, password_hash from admin_user where id = $1")
            .bind(id)
            .fetch_one(&st.pool)
            .await?;
    if email != current_email.to_lowercase() {
        let ok = hash
            .as_deref()
            .map(|h| verify_password(h, &body.current_password))
            .unwrap_or(false);
        if !ok {
            return Err(AppError::BadRequest(
                "Mot de passe actuel requis pour changer l'e-mail.".into(),
            ));
        }
        let taken: bool = sqlx::query_scalar(
            "select exists(select 1 from admin_user where lower(email) = $1 and id <> $2)",
        )
        .bind(&email)
        .bind(id)
        .fetch_one(&st.pool)
        .await?;
        if taken {
            return Err(AppError::BadRequest(
                "Cet e-mail est déjà utilisé par un autre compte.".into(),
            ));
        }
    }
    let dto = sqlx::query_as::<_, MeDto>(
        "update admin_user set display_name = $2, email = $3 \
         where id = $1 returning id, email, display_name, is_super",
    )
    .bind(id)
    .bind(display_name)
    .bind(&email)
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
    tourist_tax_included: bool,
    arrival_instructions: String,
    house_rules: String,
    contract_template: String,
    owner_name: String,
    owner_address: String,
    owner_phone: String,
    owner_email: String,
    owner_siret: String,
}

async fn get_property(
    State(st): State<AppState>,
    Path(slug): Path<String>,
) -> Result<Json<AdminPropertyDto>, AppError> {
    let dto = sqlx::query_as::<_, AdminPropertyDto>(
        "select slug, name, location_label, description, surface_label, capacity, bedrooms, \
                specs_label, highlight_label, hero_seed, deposit_pct, caution_cents, \
                tourist_tax_cents, tourist_tax_included, arrival_instructions, house_rules, \
                contract_template, owner_name, owner_address, owner_phone, owner_email, owner_siret \
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
    tourist_tax_included: bool,
    #[serde(default)]
    arrival_instructions: String,
    #[serde(default)]
    house_rules: String,
    #[serde(default)]
    contract_template: String,
    #[serde(default)]
    owner_name: String,
    #[serde(default)]
    owner_address: String,
    #[serde(default)]
    owner_phone: String,
    #[serde(default)]
    owner_email: String,
    #[serde(default)]
    owner_siret: String,
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
    // Sanitize the rich-text fields server-side: they are rendered (site public,
    // espace client, fiches admin) via dangerouslySetInnerHTML, so a compromised
    // admin session must not be able to inject executable HTML/JS. ammonia keeps
    // the safe Tiptap subset. Consignes d'accès et règlement intérieur sont du
    // HTML riche au même titre que la description.
    let clean_description = ammonia::clean(&p.description);
    let clean_instructions = ammonia::clean(&p.arrival_instructions);
    let clean_rules = ammonia::clean(&p.house_rules);
    let dto = sqlx::query_as::<_, AdminPropertyDto>(
        "update property set name=$2, location_label=$3, description=$4, surface_label=$5, \
                capacity=$6, bedrooms=$7, specs_label=$8, highlight_label=$9, hero_seed=$10, \
                deposit_pct=$11, caution_cents=$12, arrival_instructions=$13, house_rules=$14, \
                tourist_tax_cents=$15, tourist_tax_included=$16, owner_name=$17, owner_address=$18, \
                owner_phone=$19, owner_email=$20, owner_siret=$21, contract_template=$22, \
                updated_at=now() \
         where slug=$1 \
         returning slug, name, location_label, description, surface_label, capacity, bedrooms, \
                   specs_label, highlight_label, hero_seed, deposit_pct, caution_cents, \
                   tourist_tax_cents, tourist_tax_included, arrival_instructions, house_rules, \
                   contract_template, owner_name, owner_address, owner_phone, owner_email, owner_siret",
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
    .bind(&clean_instructions)
    .bind(&clean_rules)
    .bind(p.tourist_tax_cents)
    .bind(p.tourist_tax_included)
    .bind(p.owner_name.trim())
    .bind(p.owner_address.trim())
    .bind(p.owner_phone.trim())
    .bind(p.owner_email.trim())
    .bind(p.owner_siret.trim())
    .bind(p.contract_template.trim())
    .fetch_optional(&st.pool)
    .await?
    .ok_or_else(|| AppError::NotFound("propriété".into()))?;
    Ok(Json(dto))
}

// ---------------------------------------------------------------------------
// Traductions des contenus éditoriaux (multilangue public)
// ---------------------------------------------------------------------------

/// Champs traduisibles d'une propriété. Les clés reprennent le camelCase des
/// DTO publics — l'overlay (i18n::tr_field) se fait clé à clé, vide = repli
/// sur le français.
const PROPERTY_TR_KEYS: &[&str] = &[
    "description",
    "surfaceLabel",
    "specsLabel",
    "highlightLabel",
    "locationLabel",
    "arrivalInstructions",
    "houseRules",
    "contractTemplate",
    "instructionsCheque",
    "instructionsVirement",
];

/// Champs riches (Tiptap) : sanitisés comme leurs équivalents français.
const PROPERTY_TR_RICH: &[&str] = &["description", "arrivalInstructions", "houseRules"];

async fn get_property_translations(
    State(st): State<AppState>,
    Path(slug): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    let tr: serde_json::Value =
        sqlx::query_scalar("select translations from property where slug = $1")
            .bind(&slug)
            .fetch_optional(&st.pool)
            .await?
            .ok_or_else(|| AppError::NotFound("propriété".into()))?;
    Ok(Json(tr))
}

async fn update_property_translations(
    State(st): State<AppState>,
    Path(slug): Path<String>,
    Json(body): Json<serde_json::Value>,
) -> Result<Json<serde_json::Value>, AppError> {
    // Forme attendue : { "en": { "description": "...", ... } }. Seules les
    // langues et clés connues sont retenues ; les champs riches sont sanitisés.
    let mut clean = serde_json::Map::new();
    for lang in ["en"] {
        let Some(fields) = body.get(lang).and_then(|v| v.as_object()) else {
            continue;
        };
        let mut out = serde_json::Map::new();
        for key in PROPERTY_TR_KEYS {
            let Some(v) = fields.get(*key).and_then(|v| v.as_str()) else {
                continue;
            };
            let v = if PROPERTY_TR_RICH.contains(key) {
                ammonia::clean(v)
            } else {
                v.trim().to_string()
            };
            if !v.is_empty() {
                out.insert((*key).to_string(), serde_json::Value::String(v));
            }
        }
        if !out.is_empty() {
            clean.insert(lang.to_string(), serde_json::Value::Object(out));
        }
    }
    let clean = serde_json::Value::Object(clean);
    let updated: Option<serde_json::Value> = sqlx::query_scalar(
        "update property set translations = $2, updated_at = now() \
         where slug = $1 returning translations",
    )
    .bind(&slug)
    .bind(&clean)
    .fetch_optional(&st.pool)
    .await?;
    updated
        .map(Json)
        .ok_or_else(|| AppError::NotFound("propriété".into()))
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
    /// Référence + client de la réservation qui tient la semaine (si réservée).
    booking_reference: Option<String>,
    booking_customer: Option<String>,
    /// Nom du flux iCal externe qui a bloqué la semaine (null = blocage manuel).
    blocked_source: Option<String>,
}

/// Sous-requêtes réf + client de la réservation confirmée qui tient la semaine.
const WEEK_BOOKING_COLS: &str = ", \
    (select b.reference from booking b where b.week_id = aw.id \
        and b.status in ('confirmed','balance_paid') order by b.created_at desc limit 1) as booking_reference, \
    (select nullif(trim(coalesce(c.first_name,'') || ' ' || coalesce(c.last_name,'')), '') \
        from booking b left join customer c on c.id = b.customer_id where b.week_id = aw.id \
        and b.status in ('confirmed','balance_paid') order by b.created_at desc limit 1) as booking_customer, \
    (select f.name from ical_feed f where f.id = aw.blocked_by_feed) as blocked_source";

/// Relit une semaine avec ses colonnes calculées (réf/client/source iCal).
/// À utiliser après un insert/update : un `returning` nu ne fournit pas ces
/// colonnes et le décodage en AdminWeekDto échouerait (ColumnNotFound).
async fn week_dto_by_id(
    pool: &sqlx::PgPool,
    id: Uuid,
) -> Result<Option<AdminWeekDto>, sqlx::Error> {
    sqlx::query_as::<_, AdminWeekDto>(&format!(
        "select aw.id, aw.start_date, aw.end_date, aw.range_label, aw.sub_label, \
                aw.price_cents, aw.status, aw.position, aw.season_id, aw.tier_key{WEEK_BOOKING_COLS} \
         from availability_week aw where aw.id = $1"
    ))
    .bind(id)
    .fetch_optional(pool)
    .await
}

async fn list_weeks(
    State(st): State<AppState>,
    Query(q): Query<WeeksQuery>,
) -> Result<Json<Vec<AdminWeekDto>>, AppError> {
    let weeks = match q.season_id {
        Some(season_id) => {
            sqlx::query_as::<_, AdminWeekDto>(&format!(
                "select aw.id, aw.start_date, aw.end_date, aw.range_label, aw.sub_label, \
                        aw.price_cents, aw.status, aw.position, aw.season_id, aw.tier_key{WEEK_BOOKING_COLS} \
                 from availability_week aw \
                 where aw.season_id = $1 order by aw.start_date, aw.position"
            ))
            .bind(season_id)
            .fetch_all(&st.pool)
            .await?
        }
        None => {
            sqlx::query_as::<_, AdminWeekDto>(&format!(
                "select aw.id, aw.start_date, aw.end_date, aw.range_label, aw.sub_label, \
                        aw.price_cents, aw.status, aw.position, aw.season_id, aw.tier_key{WEEK_BOOKING_COLS} \
                 from availability_week aw join property p on p.id = aw.property_id \
                 where p.slug = $1 order by aw.start_date, aw.position"
            ))
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
    let updated: Option<Uuid> = sqlx::query_scalar(
        // Un changement de statut hors 'blocked' efface la source iCal : la
        // semaine redevient pilotée à la main (sinon la synchro suivante la
        // re-bloquerait/débloquerait sans que l'exploitant comprenne pourquoi).
        "update availability_week set price_cents=$2, status=$3, sub_label=$4, tier_key=$5, \
                blocked_by_feed = case when $3 = 'blocked' then blocked_by_feed else null end \
         where id=$1 returning id",
    )
    .bind(id)
    .bind(w.price_cents)
    .bind(&w.status)
    .bind(&w.sub_label)
    .bind(w.tier_key.as_deref())
    .fetch_optional(&st.pool)
    .await?;
    let id = updated.ok_or_else(|| AppError::NotFound("semaine".into()))?;
    let dto = week_dto_by_id(&st.pool, id)
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
    /// Traductions anglaises (product.translations->'en'), vides = repli fr.
    label_en: String,
    description_en: String,
}

async fn list_products(State(st): State<AppState>) -> Result<Json<Vec<AdminProductDto>>, AppError> {
    let products = sqlx::query_as::<_, AdminProductDto>(
        "select id, key, label, description, price_cents, active, position, \
                coalesce(translations->'en'->>'label', '') as label_en, \
                coalesce(translations->'en'->>'description', '') as description_en \
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
    #[serde(default)]
    label_en: String,
    #[serde(default)]
    description_en: String,
}

/// Colonnes renvoyées par les endpoints produits (avec les traductions EN).
const SELECT: &str = "id, key, label, description, price_cents, active, position, \
                coalesce(translations->'en'->>'label', '') as label_en, \
                coalesce(translations->'en'->>'description', '') as description_en";

/// jsonb translations d'un produit à partir des champs EN du formulaire.
fn product_translations(p: &ProductInput) -> serde_json::Value {
    let mut en = serde_json::Map::new();
    if !p.label_en.trim().is_empty() {
        en.insert(
            "label".into(),
            serde_json::Value::String(p.label_en.trim().into()),
        );
    }
    if !p.description_en.trim().is_empty() {
        en.insert(
            "description".into(),
            serde_json::Value::String(p.description_en.trim().into()),
        );
    }
    if en.is_empty() {
        serde_json::json!({})
    } else {
        serde_json::json!({ "en": en })
    }
}

async fn create_product(
    State(st): State<AppState>,
    Json(p): Json<ProductInput>,
) -> Result<Json<AdminProductDto>, AppError> {
    if p.key.trim().is_empty() || p.label.trim().is_empty() {
        return Err(AppError::BadRequest("Clé et libellé requis.".into()));
    }
    let dto = sqlx::query_as::<_, AdminProductDto>(
        &format!(
            "insert into product (key, label, description, price_cents, active, position, translations) \
         values ($1,$2,$3,$4,$5,$6,$7) \
         returning {SELECT}"
        ),
    )
    .bind(p.key.trim())
    .bind(&p.label)
    .bind(&p.description)
    .bind(p.price_cents)
    .bind(p.active)
    .bind(p.position)
    .bind(product_translations(&p))
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
    let dto = sqlx::query_as::<_, AdminProductDto>(&format!(
        "update product set key=$2, label=$3, description=$4, price_cents=$5, active=$6, \
                position=$7, translations=$8 \
         where id=$1 \
         returning {SELECT}"
    ))
    .bind(id)
    .bind(p.key.trim())
    .bind(&p.label)
    .bind(&p.description)
    .bind(p.price_cents)
    .bind(p.active)
    .bind(p.position)
    .bind(product_translations(&p))
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
    start_date: NaiveDate,
    end_date: NaiveDate,
    season_id: Option<Uuid>,
    adults: i32,
    children: i32,
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
    customer_phone: Option<String>,
    created_at: DateTime<Utc>,
}

async fn list_bookings(State(st): State<AppState>) -> Result<Json<Vec<AdminBookingDto>>, AppError> {
    let rows = sqlx::query_as::<_, AdminBookingDto>(
        "select b.reference, b.status, aw.range_label as week_range, aw.start_date, aw.end_date, \
                aw.season_id, b.adults, b.children, \
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
                nullif(trim(coalesce(c.phone,'')), '') as customer_phone, \
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

#[derive(Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
struct SeasonFinanceRow {
    name: String,
    weeks_total: i64,
    /// Hors semaines bloquées (non commercialisables) — même définition que le Planning.
    weeks_sellable: i64,
    weeks_booked: i64,
    /// Loyers des semaines réservées (prix affiché des semaines booked).
    revenue_booked_cents: i64,
    /// Acomptes + soldes effectivement réglés sur les dossiers de la saison.
    collected_cents: i64,
    /// Soldes restant à encaisser (dossiers confirmés non soldés).
    upcoming_cents: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FinancesResponse {
    summary: FinanceSummary,
    seasons: Vec<SeasonFinanceRow>,
    tax_declaration: Vec<TaxDeclarationRow>,
}

// ---------------------------------------------------------------------------
// Détail d'un dossier de réservation (page admin) : récap + accès + contrat +
// règlement + suivi des e-mails.
// ---------------------------------------------------------------------------

#[derive(Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
struct BookingDetailRow {
    reference: String,
    status: String,
    channel: String,
    emails_muted: bool,
    week_range: String,
    arrival: String,
    start_date: NaiveDate,
    adults: i32,
    children: i32,
    total_cents: i64,
    deposit_cents: i64,
    balance_cents: i64,
    caution_cents: i64,
    tourist_tax_cents: i64,
    deposit_pct: i32,
    payment_method: Option<String>,
    caution_method: Option<String>,
    admin_notes: Option<String>,
    deposit_paid_at: Option<DateTime<Utc>>,
    balance_paid_at: Option<DateTime<Utc>>,
    caution_released_at: Option<DateTime<Utc>>,
    caution_captured_cents: Option<i64>,
    deposit_refunded_cents: i64,
    balance_refunded_cents: i64,
    payment_flag: Option<String>,
    balance_attempts: i32,
    balance_last_error: Option<String>,
    caution_attempts: i32,
    caution_last_error: Option<String>,
    contract_version: Option<String>,
    contract_signed_at: Option<DateTime<Utc>>,
    contract_text: Option<String>,
    has_signature: bool,
    created_at: DateTime<Utc>,
    cancelled_at: Option<DateTime<Utc>>,
    customer_id: Option<Uuid>,
    customer_name: Option<String>,
    customer_email: Option<String>,
    customer_phone: Option<String>,
    customer_address: Option<String>,
    arrival_instructions: String,
    house_rules: String,
    owner_name: String,
    owner_address: String,
    owner_siret: String,
}

#[derive(Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
struct PaymentDto {
    kind: String,
    method: Option<String>,
    provider: String,
    amount_cents: i64,
    status: String,
    created_at: DateTime<Utc>,
}

#[derive(Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
struct EmailDto {
    kind: String,
    subject: String,
    recipient: String,
    status: String,
    error: Option<String>,
    created_at: DateTime<Utc>,
    sent_at: Option<DateTime<Utc>>,
    delivered_at: Option<DateTime<Utc>>,
    opened_at: Option<DateTime<Utc>>,
}

#[derive(Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
struct NoteDto {
    body: String,
    author: Option<String>,
    created_at: DateTime<Utc>,
}

#[derive(Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
struct BookingEventDto {
    kind: String,
    title: String,
    detail: Option<String>,
    actor_name: Option<String>,
    created_at: DateTime<Utc>,
}

#[derive(Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
struct LineDto {
    kind: String,
    label: String,
    quantity: i32,
    unit_price_cents: i64,
    total_cents: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BookingDetail {
    booking: BookingDetailRow,
    lines: Vec<LineDto>,
    payments: Vec<PaymentDto>,
    emails: Vec<EmailDto>,
    notes: Vec<NoteDto>,
    events: Vec<BookingEventDto>,
}

async fn booking_detail(
    State(st): State<AppState>,
    Path(reference): Path<String>,
) -> Result<Json<BookingDetail>, AppError> {
    let booking = sqlx::query_as::<_, BookingDetailRow>(
        "select b.reference, b.status, b.channel, b.emails_muted, aw.range_label as week_range, \
                aw.arrival_label as arrival, aw.start_date, b.adults, b.children, \
                b.total_cents, b.deposit_cents, b.balance_cents, b.caution_cents, \
                b.tourist_tax_cents, b.deposit_pct, b.payment_method, b.caution_method, \
                b.admin_notes, b.deposit_paid_at, b.balance_paid_at, b.caution_released_at, \
                b.caution_captured_cents, \
                coalesce((select sum(p.amount_cents) from payment p where p.booking_id = b.id \
                    and p.type = 'refund' and p.raw->>'source' = 'deposit'), 0)::bigint as deposit_refunded_cents, \
                coalesce((select sum(p.amount_cents) from payment p where p.booking_id = b.id \
                    and p.type = 'refund' and p.raw->>'source' = 'balance'), 0)::bigint as balance_refunded_cents, \
                b.payment_flag, b.balance_attempts, \
                b.balance_last_error, b.caution_attempts, b.caution_last_error, \
                b.contract_version, b.contract_accepted_at as contract_signed_at, b.contract_text, \
                (b.signature_png is not null) as has_signature, b.created_at, b.cancelled_at, \
                b.customer_id, \
                nullif(trim(coalesce(c.first_name,'') || ' ' || coalesce(c.last_name,'')), '') as customer_name, \
                c.email as customer_email, c.phone as customer_phone, \
                nullif(trim(coalesce(c.address_line,'') || ' ' || coalesce(c.postal_code,'') || ' ' || coalesce(c.city,'')), '') as customer_address, \
                p.arrival_instructions, p.house_rules, \
                p.owner_name, p.owner_address, p.owner_siret \
         from booking b \
         join availability_week aw on aw.id = b.week_id \
         join property p on p.id = b.property_id \
         left join customer c on c.id = b.customer_id \
         where b.reference = $1",
    )
    .bind(&reference)
    .fetch_optional(&st.pool)
    .await?
    .ok_or_else(|| AppError::NotFound("réservation".into()))?;

    let lines = sqlx::query_as::<_, LineDto>(
        "select l.kind, l.label, l.quantity, l.unit_price_cents, l.total_cents \
         from booking_line l join booking b on b.id = l.booking_id \
         where b.reference = $1 order by l.position, l.label",
    )
    .bind(&reference)
    .fetch_all(&st.pool)
    .await?;

    let payments = sqlx::query_as::<_, PaymentDto>(
        "select p.type as kind, p.method, p.provider, p.amount_cents, p.status, p.created_at \
         from payment p join booking b on b.id = p.booking_id \
         where b.reference = $1 order by p.created_at",
    )
    .bind(&reference)
    .fetch_all(&st.pool)
    .await?;

    let emails = sqlx::query_as::<_, EmailDto>(
        "select e.kind, e.subject, e.recipient, e.status, e.error, e.created_at, \
                e.sent_at, e.delivered_at, e.opened_at \
         from email_log e join booking b on b.id = e.booking_id \
         where b.reference = $1 order by e.created_at desc",
    )
    .bind(&reference)
    .fetch_all(&st.pool)
    .await?;

    let notes = sqlx::query_as::<_, NoteDto>(
        "select n.body, n.author, n.created_at \
         from booking_note n join booking b on b.id = n.booking_id \
         where b.reference = $1 order by n.created_at desc",
    )
    .bind(&reference)
    .fetch_all(&st.pool)
    .await?;

    let events = sqlx::query_as::<_, BookingEventDto>(
        "select ev.kind, ev.title, ev.detail, ev.actor_name, ev.created_at \
         from booking_event ev join booking b on b.id = ev.booking_id \
         where b.reference = $1 order by ev.created_at desc",
    )
    .bind(&reference)
    .fetch_all(&st.pool)
    .await?;

    Ok(Json(BookingDetail {
        booking,
        lines,
        payments,
        emails,
        notes,
        events,
    }))
}

#[derive(Deserialize)]
struct NoteInput {
    body: String,
}

/// Ajoute une note interne au dossier (CRM).
async fn add_note(
    State(st): State<AppState>,
    Extension(AdminId(admin_id)): Extension<AdminId>,
    Path(reference): Path<String>,
    Json(input): Json<NoteInput>,
) -> Result<StatusCode, AppError> {
    let body = input.body.trim();
    if body.is_empty() {
        return Err(AppError::BadRequest("Note vide.".into()));
    }
    let author: Option<String> =
        sqlx::query_scalar("select display_name from admin_user where id = $1")
            .bind(admin_id)
            .fetch_optional(&st.pool)
            .await?;
    let n = sqlx::query(
        "insert into booking_note (booking_id, body, author) \
         select id, $2, $3 from booking where reference = $1",
    )
    .bind(&reference)
    .bind(body)
    .bind(author)
    .execute(&st.pool)
    .await?;
    if n.rows_affected() == 0 {
        return Err(AppError::NotFound("réservation".into()));
    }
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
struct SendEmailInput {
    subject: String,
    message: String,
}

/// Envoie un e-mail au client depuis le dossier (journalisé).
async fn send_booking_email(
    State(st): State<AppState>,
    Path(reference): Path<String>,
    Json(input): Json<SendEmailInput>,
) -> Result<StatusCode, AppError> {
    let subject = input.subject.trim().to_string();
    let message = input.message.trim();
    if subject.is_empty() || message.is_empty() {
        return Err(AppError::BadRequest("Sujet et message requis.".into()));
    }
    let row = sqlx::query_as::<_, (Uuid, Option<String>)>(
        "select b.id, c.email from booking b left join customer c on c.id = b.customer_id \
         where b.reference = $1",
    )
    .bind(&reference)
    .fetch_optional(&st.pool)
    .await?
    .ok_or_else(|| AppError::NotFound("réservation".into()))?;
    let Some(to) = row.1.filter(|e| !e.trim().is_empty()) else {
        return Err(AppError::BadRequest("Ce client n'a pas d'e-mail.".into()));
    };
    // Escape HTML then keep line breaks — the body is admin-authored plain text.
    let safe = message
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('\n', "<br>");
    let (site, location) = crate::email::brand(&st.pool).await;
    let html = crate::email::template(&site, &location, &subject, &safe, "", "");
    crate::email::spawn(st.pool.clone(), Some(row.0), "manual", to, subject, html);
    Ok(StatusCode::NO_CONTENT)
}

// ---------------------------------------------------------------------------
// Transactionnels éditables : e-mails automatiques rattachés à un événement du
// séjour (réservation / arrivée / départ / annulation) à J+offset, exécutés
// par le scheduler (voir scheduler::run_email_automations).
// ---------------------------------------------------------------------------

#[derive(Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
struct EmailAutomationDto {
    id: Uuid,
    name: String,
    event: String,
    offset_days: i32,
    channel: String,
    /// Vide = client du dossier ; sinon adresse fixe (prestataire).
    recipient_email: String,
    subject: String,
    body: String,
    active: bool,
    /// Nombre d'envois déjà effectués (suivi).
    sent_count: i64,
    created_at: DateTime<Utc>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct EmailAutomationInput {
    name: String,
    event: String,
    offset_days: i32,
    channel: String,
    #[serde(default)]
    recipient_email: String,
    subject: String,
    body: String,
    active: bool,
}

fn validate_automation(p: &EmailAutomationInput) -> Result<(), AppError> {
    if p.name.trim().is_empty() || p.subject.trim().is_empty() || p.body.trim().is_empty() {
        return Err(AppError::BadRequest("Nom, sujet et message requis.".into()));
    }
    if !["reservation", "arrival", "departure", "cancellation"].contains(&p.event.as_str()) {
        return Err(AppError::BadRequest("Événement inconnu.".into()));
    }
    if !["all", "online", "manual"].contains(&p.channel.as_str()) {
        return Err(AppError::BadRequest("Canal inconnu.".into()));
    }
    if !(-60..=365).contains(&p.offset_days) {
        return Err(AppError::BadRequest("Décalage entre J-60 et J+365.".into()));
    }
    // On ne peut pas envoyer avant un événement qui n'a pas encore eu lieu.
    if ["reservation", "cancellation"].contains(&p.event.as_str()) && p.offset_days < 0 {
        return Err(AppError::BadRequest(
            "Pour la réservation et l'annulation, le décalage doit être J0 ou plus.".into(),
        ));
    }
    // Une ou plusieurs adresses fixes, séparées par des virgules.
    for part in p.recipient_email.split(',') {
        let re = part.trim();
        let re_valid = re.contains('@') && re.rsplit('@').next().unwrap_or("").contains('.');
        if !re.is_empty() && !re_valid {
            return Err(AppError::BadRequest(format!(
                "Adresse destinataire invalide : « {re} »."
            )));
        }
    }
    Ok(())
}

const AUTOMATION_COLS: &str = "id, name, event, offset_days, channel, recipient_email, subject, body, active, \
     (select count(*) from email_automation_send s where s.automation_id = email_automation.id) as sent_count, \
     created_at";

async fn list_email_automations(
    State(st): State<AppState>,
) -> Result<Json<Vec<EmailAutomationDto>>, AppError> {
    let rows = sqlx::query_as::<_, EmailAutomationDto>(&format!(
        "select {AUTOMATION_COLS} from email_automation order by event, offset_days, name"
    ))
    .fetch_all(&st.pool)
    .await?;
    Ok(Json(rows))
}

async fn create_email_automation(
    State(st): State<AppState>,
    Json(p): Json<EmailAutomationInput>,
) -> Result<Json<EmailAutomationDto>, AppError> {
    validate_automation(&p)?;
    let row = sqlx::query_as::<_, EmailAutomationDto>(&format!(
        "insert into email_automation (name, event, offset_days, channel, recipient_email, subject, body, active) \
         values ($1, $2, $3, $4, $5, $6, $7, $8) returning {AUTOMATION_COLS}"
    ))
    .bind(p.name.trim())
    .bind(&p.event)
    .bind(p.offset_days)
    .bind(&p.channel)
    .bind(p.recipient_email.trim())
    .bind(p.subject.trim())
    .bind(&p.body)
    .bind(p.active)
    .fetch_one(&st.pool)
    .await?;
    Ok(Json(row))
}

async fn update_email_automation(
    State(st): State<AppState>,
    Path(id): Path<Uuid>,
    Json(p): Json<EmailAutomationInput>,
) -> Result<Json<EmailAutomationDto>, AppError> {
    validate_automation(&p)?;
    let row = sqlx::query_as::<_, EmailAutomationDto>(&format!(
        "update email_automation set name=$2, event=$3, offset_days=$4, channel=$5, \
                recipient_email=$6, subject=$7, body=$8, active=$9, updated_at=now() \
         where id=$1 returning {AUTOMATION_COLS}"
    ))
    .bind(id)
    .bind(p.name.trim())
    .bind(&p.event)
    .bind(p.offset_days)
    .bind(&p.channel)
    .bind(p.recipient_email.trim())
    .bind(p.subject.trim())
    .bind(&p.body)
    .bind(p.active)
    .fetch_optional(&st.pool)
    .await?
    .ok_or_else(|| AppError::NotFound("transactionnel".into()))?;
    Ok(Json(row))
}

// ---------------------------------------------------------------------------
// E-mails système personnalisables : gabarits par défaut dans le code
// (email::SYSTEM_TEMPLATES), override par type en base.
// ---------------------------------------------------------------------------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SystemEmailDto {
    kind: &'static str,
    label: &'static str,
    trigger: &'static str,
    vars: Vec<&'static str>,
    default_subject: &'static str,
    default_body: &'static str,
    cta_label: &'static str,
    /// Override actif (sinon le défaut s'applique).
    subject: Option<String>,
    body: Option<String>,
    customized: bool,
}

#[derive(Deserialize)]
struct EmailLocaleQuery {
    #[serde(default)]
    locale: Option<String>,
}

async fn list_email_overrides(
    State(st): State<AppState>,
    Query(q): Query<EmailLocaleQuery>,
) -> Result<Json<Vec<SystemEmailDto>>, AppError> {
    // Chaque langue a ses gabarits par défaut et ses overrides (kind, locale).
    let lang = crate::i18n::Lang::from_param(q.locale.as_deref());
    let overrides: Vec<(String, String, String)> =
        sqlx::query_as("select kind, subject, body from email_template_override where locale = $1")
            .bind(lang.as_str())
            .fetch_all(&st.pool)
            .await?;
    let en = lang == crate::i18n::Lang::En;
    let list = crate::email::SYSTEM_TEMPLATES
        .iter()
        .map(|t| {
            let ovr = overrides.iter().find(|(k, _, _)| k == t.kind);
            SystemEmailDto {
                kind: t.kind,
                label: t.label,
                trigger: t.trigger,
                vars: t.vars.to_vec(),
                default_subject: if en { t.subject_en } else { t.subject },
                default_body: if en { t.body_en } else { t.body },
                cta_label: if en { t.cta_label_en } else { t.cta_label },
                subject: ovr.map(|(_, s, _)| s.clone()),
                body: ovr.map(|(_, _, b)| b.clone()),
                customized: ovr.is_some(),
            }
        })
        .collect();
    Ok(Json(list))
}

#[derive(Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
struct EmailStatRow {
    kind: String,
    sent: i64,
    delivered: i64,
    opened: i64,
    failed: i64,
}

/// Suivi des envois par type sur les 90 derniers jours (délivrance et
/// ouvertures alimentées par le webhook Resend).
async fn email_stats(State(st): State<AppState>) -> Result<Json<Vec<EmailStatRow>>, AppError> {
    let rows = sqlx::query_as::<_, EmailStatRow>(
        "select kind, count(*) as sent, \
                count(delivered_at) as delivered, \
                count(opened_at) as opened, \
                count(*) filter (where status = 'failed') as failed \
         from email_log \
         where created_at > now() - interval '90 days' \
         group by kind order by sent desc",
    )
    .fetch_all(&st.pool)
    .await?;
    Ok(Json(rows))
}

#[derive(Deserialize)]
struct OverrideInput {
    subject: String,
    body: String,
}

async fn upsert_email_override(
    State(st): State<AppState>,
    Path(kind): Path<String>,
    Query(q): Query<EmailLocaleQuery>,
    Json(p): Json<OverrideInput>,
) -> Result<StatusCode, AppError> {
    if !crate::email::SYSTEM_TEMPLATES
        .iter()
        .any(|t| t.kind == kind)
    {
        return Err(AppError::NotFound("e-mail système".into()));
    }
    if p.subject.trim().is_empty() || p.body.trim().is_empty() {
        return Err(AppError::BadRequest("Sujet et message requis.".into()));
    }
    let lang = crate::i18n::Lang::from_param(q.locale.as_deref());
    sqlx::query(
        "insert into email_template_override (kind, subject, body, locale) values ($1, $2, $3, $4) \
         on conflict (kind, locale) do update set subject = excluded.subject, body = excluded.body, \
             updated_at = now()",
    )
    .bind(&kind)
    .bind(p.subject.trim())
    .bind(&p.body)
    .bind(lang.as_str())
    .execute(&st.pool)
    .await?;
    Ok(StatusCode::NO_CONTENT)
}

/// Supprime l'override → le gabarit par défaut s'applique de nouveau.
async fn delete_email_override(
    State(st): State<AppState>,
    Path(kind): Path<String>,
    Query(q): Query<EmailLocaleQuery>,
) -> Result<StatusCode, AppError> {
    let lang = crate::i18n::Lang::from_param(q.locale.as_deref());
    sqlx::query("delete from email_template_override where kind = $1 and locale = $2")
        .bind(&kind)
        .bind(lang.as_str())
        .execute(&st.pool)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
struct PreviewInput {
    subject: String,
    body: String,
}

/// Aperçu d'un transactionnel : même moteur de rendu que l'envoi réel
/// (variables d'exemple, instructions d'accès réelles, gabarit du site).
async fn preview_email_automation(
    State(st): State<AppState>,
    Json(p): Json<PreviewInput>,
) -> Result<Json<serde_json::Value>, AppError> {
    let access: String =
        sqlx::query_scalar("select arrival_instructions from property order by created_at limit 1")
            .fetch_optional(&st.pool)
            .await?
            .unwrap_or_default();
    let vars = crate::scheduler::booking_vars(&crate::scheduler::TemplateBooking {
        first_name: Some("Camille"),
        last_name: Some("Durand"),
        reference: "ADR-3F7A2C",
        week_range: "07 — 14 fév",
        arrival: "samedi 7 février 2027",
        end_date: chrono::NaiveDate::from_ymd_opt(2027, 2, 14).unwrap(),
        total_cents: 169_000,
        deposit_cents: 50_700,
        balance_cents: 118_300,
        arrival_instructions: &access,
    });
    let mut vars = vars;
    let (site, location) = crate::email::brand(&st.pool).await;
    vars.extend([
        ("bonjour", "Bonjour Camille,".to_string()),
        ("montant", "1 183 €".to_string()),
        ("date", "24 janvier 2027".to_string()),
        (
            "operation",
            "le prélèvement du solde de votre séjour".to_string(),
        ),
        ("remboursement", String::new()),
        ("site", site.clone()),
    ]);
    let subject = crate::email::render_template(&p.subject, &vars, false);
    let body = crate::email::render_email_body(&p.body, &vars);
    let html = crate::email::template(
        &site,
        &location,
        &subject,
        &body,
        "Mon espace",
        &format!("{}/espace", crate::email::front_url()),
    );
    Ok(Json(
        serde_json::json!({ "subject": subject, "html": html }),
    ))
}

async fn delete_email_automation(
    State(st): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, AppError> {
    let res = sqlx::query("delete from email_automation where id = $1")
        .bind(id)
        .execute(&st.pool)
        .await?;
    if res.rows_affected() == 0 {
        return Err(AppError::NotFound("transactionnel".into()));
    }
    Ok(StatusCode::NO_CONTENT)
}

// ---------------------------------------------------------------------------
// Comptes admin : le superadmin (premier compte) crée/supprime des
// sous-comptes ; chacun peut changer son mot de passe. Journal d'audit.
// ---------------------------------------------------------------------------

#[derive(Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
struct AdminUserDto {
    id: Uuid,
    email: String,
    display_name: String,
    is_super: bool,
    /// Invitation envoyée mais mot de passe pas encore défini.
    pending: bool,
    created_at: DateTime<Utc>,
}

/// Crée un jeton (invitation 7 j / réinitialisation 1 h) et envoie l'e-mail
/// avec le lien vers la page de définition du mot de passe.
async fn send_password_link(
    st: &AppState,
    admin_id: Uuid,
    email_to: &str,
    name: &str,
    invite: bool,
) -> Result<(), AppError> {
    let token = new_token();
    let hours = if invite { 7 * 24 } else { 1 };
    sqlx::query(
        "insert into admin_password_token (token, admin_user_id, kind, expires_at) \
         values ($1, $2, $3, now() + ($4 || ' hours')::interval)",
    )
    .bind(&token)
    .bind(admin_id)
    .bind(if invite { "invite" } else { "reset" })
    .bind(hours.to_string())
    .execute(&st.pool)
    .await?;
    let url = format!(
        "{}/admin/definir-mot-de-passe?token={token}",
        crate::email::front_url()
    );
    let greeting = if name.is_empty() {
        "Bonjour".to_string()
    } else {
        format!("Bonjour {name}")
    };
    let (site, location) = crate::email::brand(&st.pool).await;
    let (subject, body) = if invite {
        (
            format!("Votre accès administrateur — {site}"),
            format!(
                "{greeting},<br><br>Un accès au back-office de {site} vient de vous être créé. \
                 Définissez votre mot de passe pour activer votre compte. \
                 Ce lien est valable 7 jours."
            ),
        )
    } else {
        (
            format!("Réinitialisation de votre mot de passe — {site}"),
            format!(
                "{greeting},<br><br>Vous avez demandé la réinitialisation de votre mot de passe. \
                 Ce lien est valable 1 heure. Si vous n'êtes pas à l'origine de cette demande, \
                 ignorez cet e-mail."
            ),
        )
    };
    let html = crate::email::template(
        &site,
        &location,
        &subject,
        &body,
        "Définir mon mot de passe",
        &url,
    );
    crate::email::spawn(
        st.pool.clone(),
        None,
        if invite {
            "admin_invite"
        } else {
            "admin_reset"
        },
        email_to.to_string(),
        subject.to_string(),
        html,
    );
    Ok(())
}

async fn require_super(pool: &sqlx::PgPool, admin_id: Uuid) -> Result<(), AppError> {
    let is_super: bool = sqlx::query_scalar("select is_super from admin_user where id = $1")
        .bind(admin_id)
        .fetch_optional(pool)
        .await?
        .unwrap_or(false);
    if !is_super {
        return Err(AppError::BadRequest(
            "Action réservée au compte principal.".into(),
        ));
    }
    Ok(())
}

async fn list_admin_users(State(st): State<AppState>) -> Result<Json<Vec<AdminUserDto>>, AppError> {
    let rows = sqlx::query_as::<_, AdminUserDto>(
        "select id, email, display_name, is_super, (password_hash is null) as pending, \
                created_at from admin_user order by created_at",
    )
    .fetch_all(&st.pool)
    .await?;
    Ok(Json(rows))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateAdminInput {
    email: String,
    display_name: String,
}

/// Crée un compte SANS mot de passe et envoie une invitation : la personne
/// définit elle-même son mot de passe via le lien reçu.
async fn create_admin_user(
    State(st): State<AppState>,
    Json(p): Json<CreateAdminInput>,
) -> Result<Json<AdminUserDto>, AppError> {
    let email = p.email.trim().to_lowercase();
    if !(email.contains('@') && email.rsplit('@').next().unwrap_or("").contains('.')) {
        return Err(AppError::BadRequest("E-mail invalide.".into()));
    }
    if p.display_name.trim().is_empty() {
        return Err(AppError::BadRequest("Nom requis.".into()));
    }
    let row = sqlx::query_as::<_, AdminUserDto>(
        "insert into admin_user (email, password_hash, display_name) values ($1, null, $2) \
         on conflict (email) do nothing \
         returning id, email, display_name, is_super, (password_hash is null) as pending, created_at",
    )
    .bind(&email)
    .bind(p.display_name.trim())
    .fetch_optional(&st.pool)
    .await?
    .ok_or_else(|| AppError::BadRequest("Un compte existe déjà avec cet e-mail.".into()))?;
    send_password_link(&st, row.id, &row.email, &row.display_name, true).await?;
    Ok(Json(row))
}

/// Renvoie l'invitation d'un compte encore en attente (lien perdu/expiré).
async fn reinvite_admin_user(
    State(st): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, AppError> {
    let row: Option<(String, String, bool)> = sqlx::query_as(
        "select email, display_name, (password_hash is null) from admin_user where id = $1",
    )
    .bind(id)
    .fetch_optional(&st.pool)
    .await?;
    let Some((email, name, pending)) = row else {
        return Err(AppError::NotFound("compte".into()));
    };
    if !pending {
        return Err(AppError::BadRequest(
            "Ce compte est déjà actif — utiliser « mot de passe oublié ».".into(),
        ));
    }
    send_password_link(&st, id, &email, &name, true).await?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
struct ForgotInput {
    email: String,
}

/// Public. Répond toujours 204 (pas d'énumération de comptes) ; envoie un
/// lien de réinitialisation (ou une nouvelle invitation si le compte est
/// encore en attente).
async fn password_forgot(
    State(st): State<AppState>,
    headers: HeaderMap,
    Json(p): Json<ForgotInput>,
) -> Result<StatusCode, AppError> {
    st.rate.check(
        "admin-forgot",
        &crate::rate::client_ip(&headers),
        5,
        std::time::Duration::from_secs(600),
    )?;
    let row: Option<(Uuid, String, String, bool)> = sqlx::query_as(
        "select id, email, display_name, (password_hash is null) from admin_user \
         where email = $1",
    )
    .bind(p.email.trim().to_lowercase())
    .fetch_optional(&st.pool)
    .await?;
    if let Some((id, email, name, pending)) = row {
        send_password_link(&st, id, &email, &name, pending).await?;
    }
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
struct SetPasswordInput {
    token: String,
    password: String,
}

/// Public. Consomme un jeton (invitation ou réinitialisation), définit le mot
/// de passe et connecte directement la personne.
async fn password_set(
    State(st): State<AppState>,
    headers: HeaderMap,
    Json(p): Json<SetPasswordInput>,
) -> Result<Response, AppError> {
    st.rate.check(
        "admin-set-password",
        &crate::rate::client_ip(&headers),
        10,
        std::time::Duration::from_secs(600),
    )?;
    if p.password.len() < 8 {
        return Err(AppError::BadRequest(
            "Mot de passe : 8 caractères minimum.".into(),
        ));
    }
    let row: Option<(Uuid,)> = sqlx::query_as(
        "update admin_password_token set used_at = now() \
         where token = $1 and used_at is null and expires_at > now() \
         returning admin_user_id",
    )
    .bind(p.token.trim())
    .fetch_optional(&st.pool)
    .await?;
    let Some((user_id,)) = row else {
        return Err(AppError::BadRequest(
            "Lien invalide ou expiré — demandez-en un nouveau.".into(),
        ));
    };
    let hash =
        hash_password(&p.password).map_err(|_| AppError::Internal("hash mot de passe".into()))?;
    sqlx::query("update admin_user set password_hash = $2 where id = $1")
        .bind(user_id)
        .bind(&hash)
        .execute(&st.pool)
        .await?;
    // Les autres jetons en circulation pour ce compte deviennent caducs.
    sqlx::query("delete from admin_password_token where admin_user_id = $1 and used_at is null")
        .bind(user_id)
        .execute(&st.pool)
        .await?;

    let admin = sqlx::query_as::<_, AdminRow>(
        "select id, password_hash, email, display_name, is_super from admin_user where id = $1",
    )
    .bind(user_id)
    .fetch_one(&st.pool)
    .await?;
    audit(
        st.pool.clone(),
        admin.id,
        if admin.display_name.is_empty() {
            admin.email.clone()
        } else {
            admin.display_name.clone()
        },
        "PASSWORD".into(),
        "/api/admin/password/set".into(),
    );

    // Connexion directe : même mécanique que login.
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
    let mut resp = Json(MeDto {
        id: admin.id,
        email: admin.email,
        display_name: admin.display_name,
        is_super: admin.is_super,
    })
    .into_response();
    resp.headers_mut().insert(
        header::SET_COOKIE,
        cookie_value(&token, SESSION_DAYS * 24 * 3600),
    );
    Ok(resp)
}

async fn delete_admin_user(
    State(st): State<AppState>,
    Extension(AdminId(admin_id)): Extension<AdminId>,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, AppError> {
    require_super(&st.pool, admin_id).await?;
    if id == admin_id {
        return Err(AppError::BadRequest(
            "Impossible de supprimer son propre compte.".into(),
        ));
    }
    // Le compte principal est indéboulonnable (il resterait sinon un
    // back-office sans personne pour gérer les comptes).
    let res = sqlx::query("delete from admin_user where id = $1 and not is_super")
        .bind(id)
        .execute(&st.pool)
        .await?;
    if res.rows_affected() == 0 {
        return Err(AppError::BadRequest(
            "Compte introuvable ou compte principal.".into(),
        ));
    }
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChangePasswordInput {
    current_password: String,
    new_password: String,
}

async fn change_my_password(
    State(st): State<AppState>,
    Extension(AdminId(admin_id)): Extension<AdminId>,
    Json(p): Json<ChangePasswordInput>,
) -> Result<StatusCode, AppError> {
    if p.new_password.len() < 8 {
        return Err(AppError::BadRequest(
            "Mot de passe : 8 caractères minimum.".into(),
        ));
    }
    let hash: Option<String> =
        sqlx::query_scalar("select password_hash from admin_user where id = $1")
            .bind(admin_id)
            .fetch_optional(&st.pool)
            .await?;
    let Some(hash) = hash else {
        return Err(AppError::NotFound("compte".into()));
    };
    if !verify_password(&hash, &p.current_password) {
        return Err(AppError::BadRequest(
            "Mot de passe actuel incorrect.".into(),
        ));
    }
    let new_hash = hash_password(&p.new_password)
        .map_err(|_| AppError::Internal("hash mot de passe".into()))?;
    sqlx::query("update admin_user set password_hash = $2 where id = $1")
        .bind(admin_id)
        .bind(&new_hash)
        .execute(&st.pool)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
struct AuditEntryDto {
    admin_id: Option<Uuid>,
    admin_name: String,
    method: String,
    path: String,
    created_at: DateTime<Utc>,
}

async fn list_audit(State(st): State<AppState>) -> Result<Json<Vec<AuditEntryDto>>, AppError> {
    let rows = sqlx::query_as::<_, AuditEntryDto>(
        "select admin_id, admin_name, method, path, created_at \
         from admin_audit order by created_at desc limit 150",
    )
    .fetch_all(&st.pool)
    .await?;
    Ok(Json(rows))
}

#[derive(FromRow)]
struct SendContractRow {
    id: Uuid,
    token: Option<String>,
    signed: bool,
    week_range: String,
    start_date: NaiveDate,
    end_date: NaiveDate,
    email: Option<String>,
    first_name: Option<String>,
    locale: Option<String>,
}

/// Envoie (ou renvoie) au client le lien de signature électronique du contrat
/// — pensé pour les réservations manuelles, où le funnel n'est pas passé.
async fn send_contract_link(
    State(st): State<AppState>,
    Path(reference): Path<String>,
) -> Result<StatusCode, AppError> {
    let row = sqlx::query_as::<_, SendContractRow>(
        "select b.id, b.contract_sign_token as token, \
                (b.contract_accepted_at is not null) as signed, \
                aw.range_label as week_range, aw.start_date, aw.end_date, \
                c.email, c.first_name, c.locale \
         from booking b \
         join availability_week aw on aw.id = b.week_id \
         left join customer c on c.id = b.customer_id \
         where b.reference = $1 and b.status in ('confirmed','balance_paid')",
    )
    .bind(&reference)
    .fetch_optional(&st.pool)
    .await?
    .ok_or_else(|| AppError::NotFound("réservation active".into()))?;
    if row.signed {
        return Err(AppError::BadRequest("Le contrat est déjà signé.".into()));
    }
    let Some(to) = row.email.filter(|e| !e.trim().is_empty()) else {
        return Err(AppError::BadRequest("Ce client n'a pas d'e-mail.".into()));
    };
    let token = match row.token {
        Some(t) => t,
        None => {
            let t = new_token();
            sqlx::query("update booking set contract_sign_token = $2 where id = $1")
                .bind(row.id)
                .bind(&t)
                .execute(&st.pool)
                .await?;
            t
        }
    };
    let lang = crate::i18n::Lang::from_param(row.locale.as_deref());
    let semaine = if lang == crate::i18n::Lang::Fr {
        row.week_range.clone()
    } else {
        crate::i18n::range_label(row.start_date, row.end_date, lang)
    };
    let url = format!("{}/contrat/{token}", crate::email::front_url_lang(lang));
    let vars = vec![
        (
            "bonjour",
            crate::email::bonjour_lang(row.first_name.as_deref(), lang),
        ),
        ("prenom", row.first_name.clone().unwrap_or_default()),
        ("semaine", semaine),
    ];
    crate::email::send_system(
        st.pool.clone(),
        Some(row.id),
        "contract_request",
        to,
        &vars,
        &url,
        lang,
    )
    .await?;
    Ok(StatusCode::NO_CONTENT)
}

// ---------------------------------------------------------------------------
// Avis voyageurs : liste/modération (publication + réponse de l'hôte) et
// demande manuelle depuis un dossier (en plus de la demande auto post-départ).
// ---------------------------------------------------------------------------

#[derive(Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
struct ReviewDto {
    id: Uuid,
    booking_reference: String,
    week_range: String,
    customer_name: Option<String>,
    author_name: String,
    rating: i32,
    comment: String,
    published: bool,
    admin_reply: Option<String>,
    submitted_at: DateTime<Utc>,
}

async fn list_reviews(State(st): State<AppState>) -> Result<Json<Vec<ReviewDto>>, AppError> {
    let rows = sqlx::query_as::<_, ReviewDto>(
        "select r.id, b.reference as booking_reference, aw.range_label as week_range, \
                nullif(trim(coalesce(c.first_name,'') || ' ' || coalesce(c.last_name,'')), '') as customer_name, \
                r.author_name, r.rating, r.comment, r.published, r.admin_reply, r.submitted_at \
         from review r \
         join booking b on b.id = r.booking_id \
         join availability_week aw on aw.id = b.week_id \
         left join customer c on c.id = b.customer_id \
         order by r.submitted_at desc",
    )
    .fetch_all(&st.pool)
    .await?;
    Ok(Json(rows))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReviewUpdate {
    published: Option<bool>,
    admin_reply: Option<String>,
}

async fn update_review(
    State(st): State<AppState>,
    Path(id): Path<Uuid>,
    Json(input): Json<ReviewUpdate>,
) -> Result<StatusCode, AppError> {
    if let Some(reply) = &input.admin_reply {
        if reply.len() > 4000 {
            return Err(AppError::BadRequest("Réponse trop longue.".into()));
        }
    }
    let reply = input
        .admin_reply
        .map(|r| r.trim().to_string())
        .map(|r| (!r.is_empty()).then_some(r));
    let n = sqlx::query(
        "update review set published = coalesce($2, published), \
            admin_reply = case when $3 then $4 else admin_reply end \
         where id = $1",
    )
    .bind(id)
    .bind(input.published)
    .bind(reply.is_some())
    .bind(reply.flatten())
    .execute(&st.pool)
    .await?;
    if n.rows_affected() == 0 {
        return Err(AppError::NotFound("avis".into()));
    }
    Ok(StatusCode::NO_CONTENT)
}

#[derive(FromRow)]
struct RequestReviewRow {
    id: Uuid,
    token: Option<String>,
    reviewed: bool,
    week_range: String,
    start_date: NaiveDate,
    end_date: NaiveDate,
    email: Option<String>,
    first_name: Option<String>,
    locale: Option<String>,
}

/// (Ré)envoie la demande d'avis d'un dossier — utile si le client a égaré
/// l'e-mail automatique ou pour un séjour antérieur à la feature.
async fn request_review(
    State(st): State<AppState>,
    Path(reference): Path<String>,
) -> Result<StatusCode, AppError> {
    let enabled: bool =
        sqlx::query_scalar("select coalesce(bool_and(reviews_enabled), true) from property")
            .fetch_one(&st.pool)
            .await?;
    if !enabled {
        return Err(AppError::BadRequest(
            "Les avis voyageurs sont désactivés dans les réglages.".into(),
        ));
    }
    let row = sqlx::query_as::<_, RequestReviewRow>(
        "select b.id, b.review_token as token, (r.id is not null) as reviewed, \
                aw.range_label as week_range, aw.start_date, aw.end_date, \
                c.email, c.first_name, c.locale \
         from booking b \
         join availability_week aw on aw.id = b.week_id \
         left join customer c on c.id = b.customer_id \
         left join review r on r.booking_id = b.id \
         where b.reference = $1 and b.status in ('confirmed','balance_paid')",
    )
    .bind(&reference)
    .fetch_optional(&st.pool)
    .await?
    .ok_or_else(|| AppError::NotFound("réservation active".into()))?;
    if row.reviewed {
        return Err(AppError::BadRequest(
            "Ce client a déjà déposé son avis.".into(),
        ));
    }
    let Some(to) = row.email.filter(|e| !e.trim().is_empty()) else {
        return Err(AppError::BadRequest("Ce client n'a pas d'e-mail.".into()));
    };
    let token = match row.token {
        Some(t) => t,
        None => {
            let t = new_token();
            sqlx::query(
                "update booking set review_token = $2, review_requested_at = now() where id = $1",
            )
            .bind(row.id)
            .bind(&t)
            .execute(&st.pool)
            .await?;
            t
        }
    };
    let lang = crate::i18n::Lang::from_param(row.locale.as_deref());
    let semaine = if lang == crate::i18n::Lang::Fr {
        row.week_range.clone()
    } else {
        crate::i18n::range_label(row.start_date, row.end_date, lang)
    };
    let url = format!("{}/avis/{token}", crate::email::front_url_lang(lang));
    let vars = vec![
        (
            "bonjour",
            crate::email::bonjour_lang(row.first_name.as_deref(), lang),
        ),
        ("prenom", row.first_name.clone().unwrap_or_default()),
        ("semaine", semaine),
    ];
    crate::email::send_system(
        st.pool.clone(),
        Some(row.id),
        "review_request",
        to,
        &vars,
        &url,
        lang,
    )
    .await?;
    Ok(StatusCode::NO_CONTENT)
}

/// URL secrète du flux iCal de la propriété (jeton créé paresseusement).
async fn get_ical_url(
    State(st): State<AppState>,
    Path(slug): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    let existing: Option<Option<String>> =
        sqlx::query_scalar("select ical_token from property where slug = $1")
            .bind(&slug)
            .fetch_optional(&st.pool)
            .await?;
    let token = match existing {
        None => return Err(AppError::NotFound("propriété".into())),
        Some(Some(t)) => t,
        Some(None) => {
            let t = new_token();
            sqlx::query("update property set ical_token = $2 where slug = $1")
                .bind(&slug)
                .bind(&t)
                .execute(&st.pool)
                .await?;
            t
        }
    };
    let url = format!("{}/api/calendar/{token}.ics", crate::email::api_url());
    Ok(Json(serde_json::json!({ "url": url })))
}

// ---------------------------------------------------------------------------
// Import iCal entrant : calendriers externes qui bloquent des semaines
// (Airbnb, Booking, Google Agenda…). Voir src/ical.rs pour la synchro.
// ---------------------------------------------------------------------------

#[derive(Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
struct IcalFeedDto {
    id: Uuid,
    name: String,
    url: String,
    last_synced_at: Option<DateTime<Utc>>,
    last_error: Option<String>,
    /// Nombre de semaines actuellement bloquées par ce flux.
    blocked_weeks: i64,
}

const ICAL_FEED_COLS: &str = "f.id, f.name, f.url, f.last_synced_at, f.last_error, \
    (select count(*) from availability_week aw \
        where aw.blocked_by_feed = f.id and aw.status = 'blocked') as blocked_weeks";

async fn list_ical_feeds(
    State(st): State<AppState>,
    Path(slug): Path<String>,
) -> Result<Json<Vec<IcalFeedDto>>, AppError> {
    let feeds = sqlx::query_as::<_, IcalFeedDto>(&format!(
        "select {ICAL_FEED_COLS} from ical_feed f \
         join property p on p.id = f.property_id where p.slug = $1 \
         order by f.created_at"
    ))
    .bind(&slug)
    .fetch_all(&st.pool)
    .await?;
    Ok(Json(feeds))
}

#[derive(Deserialize)]
struct CreateIcalFeed {
    name: String,
    url: String,
}

async fn create_ical_feed(
    State(st): State<AppState>,
    Path(slug): Path<String>,
    Json(input): Json<CreateIcalFeed>,
) -> Result<Json<Vec<crate::ical::FeedSyncOutcome>>, AppError> {
    let name = input.name.trim();
    let url = input.url.trim();
    if name.is_empty() {
        return Err(AppError::BadRequest("Nom du calendrier requis.".into()));
    }
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err(AppError::BadRequest(
            "URL invalide (elle doit commencer par https://).".into(),
        ));
    }
    let property_id: Option<Uuid> = sqlx::query_scalar("select id from property where slug = $1")
        .bind(&slug)
        .fetch_optional(&st.pool)
        .await?;
    let property_id = property_id.ok_or_else(|| AppError::NotFound("propriété".into()))?;
    sqlx::query("insert into ical_feed (property_id, name, url) values ($1, $2, $3)")
        .bind(property_id)
        .bind(name)
        .bind(url)
        .execute(&st.pool)
        .await?;
    // Première synchro immédiate : l'exploitant voit tout de suite l'effet
    // (et l'erreur éventuelle si l'URL est mauvaise).
    Ok(Json(crate::ical::sync_all(&st.pool, true).await))
}

async fn delete_ical_feed(
    State(st): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, AppError> {
    let mut tx = st.pool.begin().await?;
    // Rouvre les semaines que ce flux avait bloquées (un blocage devenu
    // orphelin serait indébloquable automatiquement).
    sqlx::query(
        "update availability_week set status = 'available', blocked_by_feed = null \
         where blocked_by_feed = $1 and status = 'blocked'",
    )
    .bind(id)
    .execute(&mut *tx)
    .await?;
    let deleted = sqlx::query("delete from ical_feed where id = $1")
        .bind(id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    if deleted.rows_affected() == 0 {
        return Err(AppError::NotFound("calendrier".into()));
    }
    Ok(StatusCode::NO_CONTENT)
}

async fn sync_ical_feeds(
    State(st): State<AppState>,
) -> Result<Json<Vec<crate::ical::FeedSyncOutcome>>, AppError> {
    Ok(Json(crate::ical::sync_all(&st.pool, true).await))
}

/// Note interne sur la fiche contact (hors dossier).
async fn add_contact_note(
    State(st): State<AppState>,
    Extension(AdminId(admin_id)): Extension<AdminId>,
    Path(id): Path<Uuid>,
    Json(input): Json<NoteInput>,
) -> Result<StatusCode, AppError> {
    let body = input.body.trim();
    if body.is_empty() {
        return Err(AppError::BadRequest("Note vide.".into()));
    }
    let author: Option<String> =
        sqlx::query_scalar("select display_name from admin_user where id = $1")
            .bind(admin_id)
            .fetch_optional(&st.pool)
            .await?;
    let n = sqlx::query(
        "insert into contact_note (customer_id, body, author) \
         select id, $2, $3 from customer where id = $1",
    )
    .bind(id)
    .bind(body)
    .bind(author)
    .execute(&st.pool)
    .await?;
    if n.rows_affected() == 0 {
        return Err(AppError::NotFound("contact".into()));
    }
    Ok(StatusCode::NO_CONTENT)
}

/// E-mail libre à un contact, hors dossier de réservation (relance CRM).
/// Journalisé dans email_log sans booking_id ; visible sur la fiche contact.
async fn send_contact_email(
    State(st): State<AppState>,
    Path(id): Path<Uuid>,
    Json(input): Json<SendEmailInput>,
) -> Result<StatusCode, AppError> {
    let subject = input.subject.trim().to_string();
    let message = input.message.trim();
    if subject.is_empty() || message.is_empty() {
        return Err(AppError::BadRequest("Sujet et message requis.".into()));
    }
    let email = sqlx::query_scalar::<_, String>("select email from customer where id = $1")
        .bind(id)
        .fetch_optional(&st.pool)
        .await?
        .ok_or_else(|| AppError::NotFound("contact".into()))?;
    if email.trim().is_empty() {
        return Err(AppError::BadRequest("Ce contact n'a pas d'e-mail.".into()));
    }
    let safe = message
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('\n', "<br>");
    let (site, location) = crate::email::brand(&st.pool).await;
    let html = crate::email::template(&site, &location, &subject, &safe, "", "");
    crate::email::spawn(st.pool.clone(), None, "manual", email, subject, html);
    Ok(StatusCode::NO_CONTENT)
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
    #[serde(default)]
    country: String,
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
    tourist_tax_included: bool,
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
    // Offline bookings never have a saved card, so the caution can only be a cheque
    // (a 'card' caution would be impossible to charge later — no card on file).
    if input.caution_method != "cheque" {
        return Err(AppError::BadRequest(
            "La caution d'une réservation hors ligne est un chèque de caution.".into(),
        ));
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
        "select p.id, p.deposit_pct, p.caution_cents, p.tourist_tax_cents, p.tourist_tax_included \
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
        prop.tourist_tax_included,
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
         values ($1, $2, $3, $4, $5, $6, $7, $8) \
         on conflict (lower(email)) where coalesce(email, '') <> '' \
         do update set first_name = excluded.first_name, last_name = excluded.last_name, \
            phone = excluded.phone, address_line = excluded.address_line, \
            postal_code = excluded.postal_code, city = excluded.city, \
            country = excluded.country \
         returning id",
    )
    .bind(&c.email)
    .bind(&c.first_name)
    .bind(&c.last_name)
    .bind(&c.phone)
    .bind(&c.address_line)
    .bind(&c.postal_code)
    .bind(&c.city)
    .bind(if c.country.trim().is_empty() {
        "FR"
    } else {
        c.country.trim()
    })
    .fetch_one(&mut *tx)
    .await?
    .0;

    let booking_id: Uuid = sqlx::query_as::<_, (Uuid,)>(
        "insert into booking \
            (reference, property_id, customer_id, week_id, status, channel, adults, children, \
             week_price_cents, extras_total_cents, total_cents, deposit_pct, deposit_cents, \
             balance_cents, caution_cents, tourist_tax_cents, payment_method, caution_method, \
             admin_notes, deposit_paid_at, balance_paid_at, emails_muted) \
         values ($1,$2,$3,$4,'confirmed','manual',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17, \
             case when $18 then now() end, case when $19 then now() end, true) returning id",
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
    /// Date de réception (ISO 'YYYY-MM-DD'). Vide → aujourd'hui.
    #[serde(default)]
    date: Option<String>,
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
    // Pointable : réservation manuelle active, OU réservation en ligne réglée
    // hors carte (chèque/virement — y compris l'option 'pending_payment' qui
    // attend son acompte). Jamais un dossier annulé/expiré (cela réactiverait
    // une semaine libérée → double réservation).
    let row = sqlx::query_as::<_, (Uuid, i64, bool, String, Option<Uuid>)>(&format!(
        "select id, {amount_col}, ({paid_col} is not null), status, customer_id from booking \
         where reference = $1 \
           and (channel = 'manual' or payment_method in ('cheque', 'virement')) \
           and status in ('pending_payment', 'confirmed', 'balance_paid')"
    ))
    .bind(&reference)
    .fetch_optional(&st.pool)
    .await?
    .ok_or_else(|| {
        AppError::NotFound("réservation pointable (manuelle ou chèque/virement)".into())
    })?;
    if row.2 {
        return Err(AppError::BadRequest("Échéance déjà pointée.".into()));
    }
    let was_pending = row.3 == "pending_payment";
    if was_pending && body.kind == "balance" {
        return Err(AppError::BadRequest(
            "Pointez d'abord l'acompte : c'est lui qui confirme la réservation.".into(),
        ));
    }

    let mut tx = st.pool.begin().await?;
    let new_status = if body.kind == "balance" {
        "balance_paid"
    } else {
        "confirmed"
    };
    // Optional received date (noon, local TZ) — falls back to now().
    let paid_date = body.date.as_deref().filter(|s| !s.trim().is_empty());
    sqlx::query(&format!(
        "update booking set {paid_col} = coalesce(($3::date + time '12:00')::timestamptz, now()), \
            status = $2, updated_at = now() where id = $1"
    ))
    .bind(row.0)
    .bind(new_status)
    .bind(paid_date)
    .execute(&mut *tx)
    .await?;
    insert_manual_payment(&mut tx, row.0, &body.kind, row.1, &body.method).await?;
    tx.commit().await?;
    // L'encaissement de l'acompte rend l'option définitive → confirmation client
    // (l'e-mail respecte la coupure globale et le mute du dossier).
    if was_pending && body.kind == "deposit" {
        if let Some(cid) = row.4 {
            crate::send_welcome_email(&st.pool, row.0, cid, &reference).await;
        }
    }
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

    // Vue par saison : inventaire (semaines) + flux (dossiers actifs).
    let seasons = sqlx::query_as::<_, SeasonFinanceRow>(
        "select s.name, \
                count(aw.id) as weeks_total, \
                count(aw.id) filter (where aw.status <> 'blocked') as weeks_sellable, \
                count(aw.id) filter (where aw.status = 'booked') as weeks_booked, \
                coalesce(sum(aw.price_cents) filter (where aw.status = 'booked'),0)::bigint \
                    as revenue_booked_cents, \
                coalesce((select sum((case when b.deposit_paid_at is not null then b.deposit_cents else 0 end) \
                                   + (case when b.balance_paid_at is not null then b.balance_cents else 0 end)) \
                          from booking b join availability_week w on w.id = b.week_id \
                          where w.season_id = s.id and b.status in ('confirmed','balance_paid')),0)::bigint \
                    as collected_cents, \
                coalesce((select sum(b.balance_cents) \
                          from booking b join availability_week w on w.id = b.week_id \
                          where w.season_id = s.id and b.status = 'confirmed' \
                            and b.balance_paid_at is null),0)::bigint \
                    as upcoming_cents \
         from season s \
         left join availability_week aw on aw.season_id = s.id \
         group by s.id, s.name \
         having count(aw.id) > 0 \
         order by min(aw.start_date) desc",
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
        seasons,
        tax_declaration,
    }))
}

// ---------------------------------------------------------------------------
// Réglages globaux + coupure d'e-mails par réservation
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize, FromRow)]
#[serde(rename_all = "camelCase")]
struct GlobalSettings {
    transactional_emails_enabled: bool,
    online_booking_enabled: bool,
    pay_card_enabled: bool,
    pay_cheque_enabled: bool,
    pay_virement_enabled: bool,
    instructions_cheque: String,
    instructions_virement: String,
    reviews_enabled: bool,
}

const SETTINGS_COLS: &str = "transactional_emails_enabled, online_booking_enabled, \
    pay_card_enabled, pay_cheque_enabled, pay_virement_enabled, \
    instructions_cheque, instructions_virement, reviews_enabled";

/// Réglages globaux (plateforme mono-propriété : portés par la propriété).
async fn get_settings(State(st): State<AppState>) -> Result<Json<GlobalSettings>, AppError> {
    let s = sqlx::query_as::<_, GlobalSettings>(&format!(
        "select {SETTINGS_COLS} from property limit 1"
    ))
    .fetch_optional(&st.pool)
    .await?
    .ok_or_else(|| AppError::NotFound("propriété".into()))?;
    Ok(Json(s))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SettingsUpdate {
    transactional_emails_enabled: Option<bool>,
    online_booking_enabled: Option<bool>,
    pay_card_enabled: Option<bool>,
    pay_cheque_enabled: Option<bool>,
    pay_virement_enabled: Option<bool>,
    instructions_cheque: Option<String>,
    instructions_virement: Option<String>,
    reviews_enabled: Option<bool>,
}

async fn update_settings(
    State(st): State<AppState>,
    Json(body): Json<SettingsUpdate>,
) -> Result<Json<GlobalSettings>, AppError> {
    // Garde-fou : la réservation en ligne a besoin d'au moins un moyen de
    // règlement actif (sinon le tunnel serait une impasse).
    let current = sqlx::query_as::<_, (bool, bool, bool)>(
        "select pay_card_enabled, pay_cheque_enabled, pay_virement_enabled from property limit 1",
    )
    .fetch_optional(&st.pool)
    .await?
    .ok_or_else(|| AppError::NotFound("propriété".into()))?;
    let card = body.pay_card_enabled.unwrap_or(current.0);
    let cheque = body.pay_cheque_enabled.unwrap_or(current.1);
    let virement = body.pay_virement_enabled.unwrap_or(current.2);
    if !card && !cheque && !virement {
        return Err(AppError::BadRequest(
            "Activez au moins un moyen de règlement (ou fermez la réservation en ligne).".into(),
        ));
    }
    let s = sqlx::query_as::<_, GlobalSettings>(&format!(
        "update property set \
            transactional_emails_enabled = coalesce($1, transactional_emails_enabled), \
            online_booking_enabled = coalesce($2, online_booking_enabled), \
            pay_card_enabled = coalesce($3, pay_card_enabled), \
            pay_cheque_enabled = coalesce($4, pay_cheque_enabled), \
            pay_virement_enabled = coalesce($5, pay_virement_enabled), \
            instructions_cheque = coalesce($6, instructions_cheque), \
            instructions_virement = coalesce($7, instructions_virement), \
            reviews_enabled = coalesce($8, reviews_enabled) \
         returning {SETTINGS_COLS}"
    ))
    .bind(body.transactional_emails_enabled)
    .bind(body.online_booking_enabled)
    .bind(body.pay_card_enabled)
    .bind(body.pay_cheque_enabled)
    .bind(body.pay_virement_enabled)
    .bind(body.instructions_cheque)
    .bind(body.instructions_virement)
    .bind(body.reviews_enabled)
    .fetch_one(&st.pool)
    .await?;
    Ok(Json(s))
}

#[derive(Deserialize)]
struct MutedInput {
    muted: bool,
}

/// Coupe (ou réactive) les e-mails automatiques pour un dossier précis.
async fn set_emails_muted(
    State(st): State<AppState>,
    Path(reference): Path<String>,
    Json(body): Json<MutedInput>,
) -> Result<StatusCode, AppError> {
    let n = sqlx::query(
        "update booking set emails_muted = $2, updated_at = now() where reference = $1",
    )
    .bind(&reference)
    .bind(body.muted)
    .execute(&st.pool)
    .await?
    .rows_affected();
    if n == 0 {
        return Err(AppError::NotFound("réservation".into()));
    }
    Ok(StatusCode::NO_CONTENT)
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
    /// Réservations actives dont l'arrivée est aujourd'hui ou plus tard —
    /// un client fidèle avec 0 ici est un candidat à la relance.
    upcoming_count: i64,
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
                count(b.id) filter (where b.status in ('confirmed','balance_paid') \
                    and aw.start_date >= current_date) as upcoming_count, \
                (coalesce(sum(b.deposit_cents) filter (where b.deposit_paid_at is not null),0) \
                 + coalesce(sum(b.balance_cents) filter (where b.balance_paid_at is not null),0))::bigint as total_paid_cents, \
                coalesce(max(b.updated_at), c.created_at) as last_activity, \
                c.created_at \
         from customer c \
         left join booking b on b.customer_id = c.id \
         left join availability_week aw on aw.id = b.week_id \
         group by c.id \
         order by last_activity desc",
    )
    .fetch_all(&st.pool)
    .await?;
    Ok(Json(rows))
}

// ---------------------------------------------------------------------------
// Fiche contact : coordonnées éditables + réservations + historique (notes/mails).
// ---------------------------------------------------------------------------

#[derive(Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
struct ContactInfo {
    id: Uuid,
    first_name: String,
    last_name: String,
    email: String,
    phone: String,
    address_line: String,
    postal_code: String,
    city: String,
    country: String,
    created_at: DateTime<Utc>,
}

#[derive(Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
struct ContactBookingDto {
    reference: String,
    status: String,
    channel: String,
    week_range: String,
    start_date: NaiveDate,
    total_cents: i64,
    deposit_paid_at: Option<DateTime<Utc>>,
    balance_paid_at: Option<DateTime<Utc>>,
    created_at: DateTime<Utc>,
    cancelled_at: Option<DateTime<Utc>>,
}

#[derive(Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
struct ContactNoteDto {
    booking_reference: String,
    body: String,
    author: Option<String>,
    created_at: DateTime<Utc>,
}

#[derive(Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
struct ContactEmailDto {
    booking_reference: String,
    kind: String,
    subject: String,
    status: String,
    created_at: DateTime<Utc>,
    opened_at: Option<DateTime<Utc>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ContactDetail {
    contact: ContactInfo,
    bookings: Vec<ContactBookingDto>,
    notes: Vec<ContactNoteDto>,
    emails: Vec<ContactEmailDto>,
}

async fn contact_detail(
    State(st): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<ContactDetail>, AppError> {
    let contact = sqlx::query_as::<_, ContactInfo>(
        "select id, first_name, last_name, email, phone, address_line, postal_code, city, \
                country, created_at from customer where id = $1",
    )
    .bind(id)
    .fetch_optional(&st.pool)
    .await?
    .ok_or_else(|| AppError::NotFound("contact".into()))?;

    let bookings = sqlx::query_as::<_, ContactBookingDto>(
        "select b.reference, b.status, b.channel, aw.range_label as week_range, aw.start_date, \
                b.total_cents, b.deposit_paid_at, b.balance_paid_at, b.created_at, b.cancelled_at \
         from booking b join availability_week aw on aw.id = b.week_id \
         where b.customer_id = $1 order by aw.start_date desc, b.created_at desc",
    )
    .bind(id)
    .fetch_all(&st.pool)
    .await?;

    // Notes de dossiers + notes de la fiche elle-même (booking_reference vide).
    let notes = sqlx::query_as::<_, ContactNoteDto>(
        "select * from ( \
             select b.reference as booking_reference, n.body, n.author, n.created_at \
             from booking_note n join booking b on b.id = n.booking_id \
             where b.customer_id = $1 \
             union all \
             select '' as booking_reference, cn.body, cn.author, cn.created_at \
             from contact_note cn where cn.customer_id = $1 \
         ) notes order by created_at desc",
    )
    .bind(id)
    .fetch_all(&st.pool)
    .await?;

    // Inclut aussi les e-mails envoyés au contact hors dossier (booking_id null,
    // rapprochés par adresse) — ex. relance commerciale depuis la fiche.
    let emails = sqlx::query_as::<_, ContactEmailDto>(
        "select coalesce(b.reference, '') as booking_reference, e.kind, e.subject, e.status, \
                e.created_at, e.opened_at \
         from email_log e left join booking b on b.id = e.booking_id \
         where b.customer_id = $1 \
            or (e.booking_id is null and lower(e.recipient) = lower($2)) \
         order by e.created_at desc",
    )
    .bind(id)
    .bind(&contact.email)
    .fetch_all(&st.pool)
    .await?;

    Ok(Json(ContactDetail {
        contact,
        bookings,
        notes,
        emails,
    }))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateContact {
    first_name: String,
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
    #[serde(default)]
    country: String,
}

async fn update_contact(
    State(st): State<AppState>,
    Path(id): Path<Uuid>,
    Json(p): Json<UpdateContact>,
) -> Result<Json<ContactInfo>, AppError> {
    if p.email.trim().is_empty() {
        return Err(AppError::BadRequest("E-mail requis.".into()));
    }
    let dto = sqlx::query_as::<_, ContactInfo>(
        "update customer set first_name=$2, last_name=$3, email=$4, phone=$5, \
                address_line=$6, postal_code=$7, city=$8, country=$9 \
         where id=$1 \
         returning id, first_name, last_name, email, phone, address_line, postal_code, city, \
                   country, created_at",
    )
    .bind(id)
    .bind(&p.first_name)
    .bind(&p.last_name)
    .bind(&p.email)
    .bind(&p.phone)
    .bind(&p.address_line)
    .bind(&p.postal_code)
    .bind(&p.city)
    .bind(&p.country)
    .fetch_optional(&st.pool)
    .await
    .map_err(|e| match &e {
        sqlx::Error::Database(db) if db.is_unique_violation() => {
            AppError::BadRequest("Un autre contact utilise déjà cet e-mail.".into())
        }
        _ => AppError::Db(e),
    })?
    .ok_or_else(|| AppError::NotFound("contact".into()))?;
    Ok(Json(dto))
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

    // Persist everything atomically: refunds (which lock the booking row and record
    // their own payment lines), cancel, free week. Caution = card-on-file (Option B):
    // nothing is held, so nothing to release on cancellation — we never charge it.
    let mut tx = st.pool.begin().await?;
    if body.refund_deposit_cents > 0 {
        perform_refund(&mut tx, &st, b.id, "deposit", body.refund_deposit_cents).await?;
    }
    if body.refund_balance_cents > 0 {
        perform_refund(&mut tx, &st, b.id, "balance", body.refund_balance_cents).await?;
    }
    // Drop the pending balance intent so a late webhook / on-session confirm for a
    // balance the client was mid-paying can't rematch this booking and resurrect it
    // (settle_balance also guards on status — belt and braces).
    sqlx::query(
        "update booking set status = 'cancelled', cancelled_at = now(), \
            cancel_reason = $2, balance_intent_id = null, updated_at = now() where id = $1",
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
    if let Some((email, first_name, week_range, locale, start_date, end_date)) = sqlx::query_as::<
        _,
        (
            Option<String>,
            Option<String>,
            String,
            Option<String>,
            chrono::NaiveDate,
            chrono::NaiveDate,
        ),
    >(
        "select c.email, c.first_name, aw.range_label, c.locale, aw.start_date, aw.end_date \
         from booking b join availability_week aw on aw.id = b.week_id \
         left join customer c on c.id = b.customer_id where b.id = $1",
    )
    .bind(b.id)
    .fetch_optional(&st.pool)
    .await?
    .filter(|(e, ..)| e.as_deref().map(|s| !s.is_empty()).unwrap_or(false))
    {
        let lang = crate::i18n::Lang::from_param(locale.as_deref());
        let hello = crate::email::bonjour_lang(first_name.as_deref(), lang);
        let refund_line = if refunded > 0 {
            match lang {
                crate::i18n::Lang::Fr => format!(
                    "\n\nUn remboursement de {},{:02} € a été effectué sur votre moyen de \
                 paiement (délai bancaire habituel : quelques jours).",
                    refunded / 100,
                    (refunded % 100).abs()
                ),
                crate::i18n::Lang::En => format!(
                    "\n\nA refund of €{}.{:02} has been issued to your payment method \
                 (usual bank delay: a few days).",
                    refunded / 100,
                    (refunded % 100).abs()
                ),
            }
        } else {
            String::new()
        };
        let semaine = if lang == crate::i18n::Lang::Fr {
            week_range.clone()
        } else {
            crate::i18n::range_label(start_date, end_date, lang)
        };
        let vars = vec![
            ("bonjour", hello.clone()),
            ("reference", reference.to_string()),
            ("semaine", semaine),
            ("remboursement", refund_line),
        ];
        let _ = crate::email::send_system(
            st.pool.clone(),
            Some(b.id),
            "cancellation",
            email.unwrap(),
            &vars,
            "",
            lang,
        )
        .await;
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
    stay_started: bool,
    status: String,
}

/// Caution model = card-on-file + charge-on-demand (Option B) : no Stripe hold is
/// placed. The card saved at the deposit is charged only if damage is found. The
/// caution is "settled" (caution_released_at) once the operator charges or waives it.
async fn load_caution(st: &AppState, reference: &str) -> Result<CautionRow, AppError> {
    let b = sqlx::query_as::<_, CautionRow>(
        "select b.id, b.caution_cents, b.provider_customer_id, b.provider_payment_method_id, \
                b.caution_method, b.caution_released_at, \
                (aw.start_date <= current_date) as stay_started, b.status \
         from booking b join availability_week aw on aw.id = b.week_id \
         where b.reference = $1",
    )
    .bind(reference)
    .fetch_optional(&st.pool)
    .await?
    .ok_or_else(|| AppError::NotFound("réservation".into()))?;
    // Never touch the caution of a cancelled file (rule: no caution charge on
    // cancellation) or one that is not an active stay.
    if !matches!(b.status.as_str(), "confirmed" | "balance_paid") {
        return Err(AppError::BadRequest(
            "Caution indisponible : la réservation n'est pas active.".into(),
        ));
    }
    if b.caution_released_at.is_some() {
        return Err(AppError::BadRequest("Caution déjà traitée.".into()));
    }
    // Damages are assessed at check-out: no caution action before the stay begins.
    if !b.stay_started {
        return Err(AppError::BadRequest(
            "La caution ne peut être traitée qu'à partir du début du séjour.".into(),
        ));
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

    // Persist the settlement + payment row atomically: after a real card charge,
    // a half-write (booking marked settled but no payment row) would lose the
    // record of debited money. The `caution_released_at is null` guard makes it
    // idempotent under a double-click / concurrent capture: Postgres row-locking
    // serializes the two UPDATEs, the second sees 0 rows and inserts nothing (the
    // Stripe key already dedup'd the charge) — no duplicate ledger/finance line.
    let mut tx = st.pool.begin().await?;
    let settled = sqlx::query(
        "update booking set caution_captured_cents = $2, caution_released_at = now(), \
            updated_at = now() where id = $1 and caution_released_at is null",
    )
    .bind(b.id)
    .bind(body.amount_cents)
    .execute(&mut *tx)
    .await?;
    if settled.rows_affected() == 0 {
        let _ = tx.rollback().await;
        return Err(AppError::BadRequest("Caution déjà traitée.".into()));
    }
    sqlx::query(
        "insert into payment (booking_id, type, provider, provider_intent_id, amount_cents, status, method) \
         values ($1, 'caution_capture', $2, $3, $4, 'captured', $5)",
    )
    .bind(b.id)
    .bind(provider)
    .bind(&intent)
    .bind(body.amount_cents)
    .bind(method)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}

/// Close the caution without charging (no damage). No Stripe call — nothing held.
async fn release_caution(
    State(st): State<AppState>,
    Path(reference): Path<String>,
) -> Result<StatusCode, AppError> {
    let b = load_caution(&st, &reference).await?;
    // Same idempotency guard as capture: a double-click must not insert two
    // caution_release rows. Only the first UPDATE (caution_released_at null→now) wins.
    let mut tx = st.pool.begin().await?;
    let released = sqlx::query(
        "update booking set caution_captured_cents = 0, caution_released_at = now(), \
            updated_at = now() where id = $1 and caution_released_at is null",
    )
    .bind(b.id)
    .execute(&mut *tx)
    .await?;
    if released.rows_affected() == 0 {
        let _ = tx.rollback().await;
        return Err(AppError::BadRequest("Caution déjà traitée.".into()));
    }
    sqlx::query(
        "insert into payment (booking_id, type, provider, provider_intent_id, amount_cents, status) \
         values ($1, 'caution_release', $2, null, 0, 'released')",
    )
    .bind(b.id)
    .bind(st.payments.name())
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RefundInput {
    amount_cents: i64,
    #[serde(default)]
    payment_type: Option<String>,
}

/// Validate and execute a refund for `amount_cents` from the latest succeeded
/// payment of `ptype` (deposit/balance), capped at the net already-charged amount
/// (charged minus prior refunds of the same type), then record the refund row —
/// all inside the caller's transaction.
///
/// The booking row is locked `for update` first, so two concurrent refunds cannot
/// both read the same prior-refunds total and each insert a row (double-click →
/// duplicate refund line skewing finances). A Stripe payment is refunded via the
/// provider (stable idempotency key → retry-safe); a manual (cheque/virement)
/// payment is refunded offline (no provider call), recorded with provider 'manual'.
async fn perform_refund(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    st: &AppState,
    booking_id: Uuid,
    ptype: &str,
    amount_cents: i64,
) -> Result<(), AppError> {
    if amount_cents <= 0 {
        return Err(AppError::BadRequest(
            "Montant à rembourser invalide.".into(),
        ));
    }
    // Serialize refunds on this booking.
    sqlx::query("select id from booking where id = $1 for update")
        .bind(booking_id)
        .execute(&mut **tx)
        .await?;

    let src: Option<(Option<String>, i64, String)> = sqlx::query_as(
        "select provider_intent_id, amount_cents, provider from payment \
         where booking_id = $1 and type = $2 and status = 'succeeded' \
         order by created_at desc limit 1",
    )
    .bind(booking_id)
    .bind(ptype)
    .fetch_optional(&mut **tx)
    .await?;
    let (intent, charged, provider) = src
        .ok_or_else(|| AppError::BadRequest(format!("Aucun paiement « {ptype} » à rembourser.")))?;

    let already: i64 = sqlx::query_scalar(
        "select coalesce(sum(amount_cents), 0)::bigint from payment \
         where booking_id = $1 and type = 'refund' and raw->>'source' = $2",
    )
    .bind(booking_id)
    .bind(ptype)
    .fetch_one(&mut **tx)
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

    // Manual (cheque/virement) payment → offline refund, no Stripe call.
    let (refund_id, provider): (Option<String>, String) = match intent {
        Some(intent) if provider != "manual" => {
            let id = st
                .payments
                .refund(
                    &intent,
                    amount_cents,
                    &format!("refund-{booking_id}-{ptype}-{already}"),
                )
                .await?;
            (Some(id), st.payments.name().to_string())
        }
        _ => (None, "manual".to_string()),
    };

    sqlx::query(
        "insert into payment (booking_id, type, provider, provider_intent_id, amount_cents, status, raw) \
         values ($1, 'refund', $2, $3, $4, 'refunded', jsonb_build_object('source', $5::text))",
    )
    .bind(booking_id)
    .bind(&provider)
    .bind(&refund_id)
    .bind(amount_cents)
    .bind(ptype)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

/// Lève un blocage de paiement (litige / remboursement externe) posé par le webhook,
/// une fois la situation résolue manuellement — rend le dossier de nouveau opérable
/// (scheduler + paiement du solde par le client).
async fn clear_payment_flag(
    State(st): State<AppState>,
    Path(reference): Path<String>,
) -> Result<StatusCode, AppError> {
    let res = sqlx::query(
        "update booking set payment_flag = null, flagged_at = null, updated_at = now() \
         where reference = $1 and payment_flag is not null",
    )
    .bind(&reference)
    .execute(&st.pool)
    .await?;
    if res.rows_affected() == 0 {
        return Err(AppError::BadRequest(
            "Aucun blocage à lever sur cette réservation.".into(),
        ));
    }
    Ok(StatusCode::NO_CONTENT)
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
    let mut tx = st.pool.begin().await?;
    perform_refund(&mut tx, &st, bid, &ptype, body.amount_cents).await?;
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

        // Variantes redimensionnées (vignettes/héro) + validation par décodage
        // réel : un fichier qui n'est pas une image est rejeté ici, quel que
        // soit son content-type déclaré.
        let widths = match crate::media::generate_variants(&st.media_dir, &filename).await {
            Ok(w) => w,
            Err(_) => {
                let _ = tokio::fs::remove_file(st.media_dir.join(&filename)).await;
                return Err(AppError::BadRequest(
                    "Fichier illisible : ce n'est pas une image valide.".into(),
                ));
            }
        };

        let pos: i32 = sqlx::query_scalar(
            "select coalesce(max(position), -1) + 1 from property_media where property_id = $1",
        )
        .bind(prop_id)
        .fetch_one(&st.pool)
        .await?;

        let dto = sqlx::query_as::<_, AdminMediaDto>(
            "insert into property_media (property_id, filename, position, widths) \
             values ($1, $2, $3, $4) \
             returning id, '/media/' || filename as url, alt, position",
        )
        .bind(prop_id)
        .bind(&filename)
        .bind(pos)
        .bind(&widths)
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
    let row: Option<(String, Vec<i32>)> =
        sqlx::query_as("delete from property_media where id = $1 returning filename, widths")
            .bind(id)
            .fetch_optional(&st.pool)
            .await?;
    match row {
        Some((f, widths)) => {
            crate::media::remove_variants(&st.media_dir, &f, &widths).await;
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

// L'année figure toujours dans les libellés : une saison de ski chevauche deux
// années civiles, « 26 déc — 02 jan » sans année prête à confusion.
fn range_label(start: NaiveDate, end: NaiveDate) -> String {
    if start.year() != end.year() {
        format!(
            "{:02} {} {} — {:02} {} {}",
            start.day(),
            fr_month_abbr(start.month()),
            start.year(),
            end.day(),
            fr_month_abbr(end.month()),
            end.year()
        )
    } else if start.month() == end.month() {
        format!(
            "{:02} — {:02} {} {}",
            start.day(),
            end.day(),
            fr_month_abbr(end.month()),
            end.year()
        )
    } else {
        format!(
            "{:02} {} — {:02} {} {}",
            start.day(),
            fr_month_abbr(start.month()),
            end.day(),
            fr_month_abbr(end.month()),
            end.year()
        )
    }
}

fn arrival_full(d: NaiveDate) -> String {
    format!(
        "samedi {} {} {}",
        d.day(),
        fr_month_full(d.month()),
        d.year()
    )
}

fn short_label(d: NaiveDate) -> String {
    format!("sam. {} {} {}", d.day(), fr_month_abbr(d.month()), d.year())
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

    let season = sqlx::query_as::<_, (Uuid, serde_json::Value, NaiveDate, NaiveDate)>(
        "select property_id, rate_tiers, start_date, end_date from season where id = $1",
    )
    .bind(g.season_id)
    .fetch_optional(&st.pool)
    .await?
    .ok_or_else(|| AppError::NotFound("saison".into()))?;
    let prop_id = season.0;
    // Stay within the season's world: weeks must fall inside its date range.
    let (season_start, season_end) = (season.2, season.3);
    if g.start_date < season_start || g.end_date > season_end {
        return Err(AppError::BadRequest(format!(
            "Les semaines doivent rester dans la saison ({} → {}).",
            season_start, season_end
        )));
    }

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
        let row: Option<Uuid> = sqlx::query_scalar(
            "insert into availability_week \
                (property_id, season_id, tier_key, start_date, end_date, range_label, sub_label, \
                 price_cents, status, arrival_label, arrival_short, depart_short, \
                 balance_due_label, position) \
             values ($1,$2,$3,$4,$5,$6,$7,$8,'available',$9,$10,$11,$12,$13) \
             on conflict (property_id, start_date) do nothing \
             returning id",
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
        if let Some(week_id) = row {
            if let Some(dto) = week_dto_by_id(&st.pool, week_id).await? {
                created.push(dto);
            }
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
