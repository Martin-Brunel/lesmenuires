//! Background scheduler: automated jobs run every `SCHEDULER_INTERVAL_SECS` (300s).
//!
//! - Balance pre-notification e-mail in the 3-day window before J-14 (once).
//! - Solde (balance) charged off-session from J-14 to arrival; transient failures
//!   retry every tick, definitive declines are capped (see charge_due_balances) and
//!   trigger a one-time dunning e-mail — the customer then settles via /espace.
//! - Abandoned-cart reminder e-mail after 1h, cart expiry (+ intent release) after 48h.
//! - Expired auth-token purge (RGPD).
//!
//! Only online, unflagged, active bookings are picked up; cancelled/manual bookings
//! are never touched, honouring the rule "acompte gardé, solde non prélevé".

use crate::email;
use crate::payments::PaymentProvider;
use serde::Serialize;
use sqlx::postgres::PgPool;
use sqlx::FromRow;
use std::sync::Arc;
use uuid::Uuid;

/// Format cents as a French euro amount, e.g. 123456 → "1234,56 €".
pub(crate) fn eur(cents: i64) -> String {
    format!("{},{:02} €", cents / 100, (cents % 100).abs())
}

#[derive(Default, Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TickReport {
    pub balances_charged: i64,
    pub balance_failures: i64,
    pub cautions_authorized: i64,
    pub caution_failures: i64,
    pub carts_reminded: i64,
    pub carts_expired: i64,
    pub tokens_purged: i64,
    pub balances_prenotified: i64,
    pub automations_sent: i64,
    pub reviews_requested: i64,
}

impl TickReport {
    fn any(&self) -> bool {
        self.balances_charged
            + self.balance_failures
            + self.cautions_authorized
            + self.caution_failures
            + self.carts_reminded
            + self.carts_expired
            + self.tokens_purged
            + self.balances_prenotified
            + self.automations_sent
            + self.reviews_requested
            > 0
    }
}

/// Réglage global : e-mails transactionnels automatiques actifs ?
/// (Coupe les jobs de notification, jamais les prélèvements ni les envois
/// manuels de l'admin.)
pub async fn transactional_emails_enabled(pool: &PgPool) -> bool {
    sqlx::query_scalar::<_, bool>(
        "select coalesce(bool_and(transactional_emails_enabled), true) from property",
    )
    .fetch_one(pool)
    .await
    .unwrap_or(true)
}

pub async fn run_tick(pool: &PgPool, payments: &Arc<dyn PaymentProvider>) -> TickReport {
    let mut r = TickReport::default();
    let emails_on = transactional_emails_enabled(pool).await;
    if emails_on {
        if let Err(e) = prenotify_balances(pool, &mut r).await {
            tracing::error!("job pré-notif solde: {e:?}");
        }
        if let Err(e) = run_email_automations(pool, &mut r).await {
            tracing::error!("job transactionnels: {e:?}");
        }
    }
    if let Err(e) = charge_due_balances(pool, payments, emails_on, &mut r).await {
        tracing::error!("job solde: {e:?}");
    }
    if emails_on {
        if let Err(e) = remind_abandoned_carts(pool, &mut r).await {
            tracing::error!("job relance: {e:?}");
        }
    }
    if let Err(e) = expire_stale_carts(pool, payments, &mut r).await {
        tracing::error!("job expiration panier: {e:?}");
    }
    if emails_on {
        if let Err(e) = request_reviews(pool, &mut r).await {
            tracing::error!("job demande d'avis: {e:?}");
        }
    }
    if let Err(e) = purge_expired_tokens(pool, &mut r).await {
        tracing::error!("job purge jetons: {e:?}");
    }
    // Comptabilité : matérialise en écritures les flux arrivés depuis le
    // dernier tick (idempotent — les sources déjà comptabilisées sont ignorées).
    match crate::accounting::sync_ledger(pool).await {
        Ok(n) if n > 0 => tracing::info!("compta: {n} écriture(s) générée(s)"),
        Ok(_) => {}
        Err(e) => tracing::error!("job compta: {e:?}"),
    }
    r
}

/// Spawn the periodic loop.
pub fn spawn(pool: PgPool, payments: Arc<dyn PaymentProvider>, interval_secs: u64) {
    tokio::spawn(async move {
        let mut ticker = tokio::time::interval(std::time::Duration::from_secs(interval_secs));
        loop {
            ticker.tick().await;
            let report = run_tick(&pool, &payments).await;
            if report.any() {
                tracing::info!("scheduler tick: {report:?}");
            }
        }
    });
    tracing::info!("scheduler démarré (toutes les {interval_secs}s)");
}

#[derive(FromRow)]
struct BalanceDue {
    id: Uuid,
    reference: String,
    balance_cents: i64,
    provider_customer_id: String,
    provider_payment_method_id: String,
    attempts: i32,
    emails_muted: bool,
    email: Option<String>,
    first_name: Option<String>,
    notified: bool,
}

async fn charge_due_balances(
    pool: &PgPool,
    payments: &Arc<dyn PaymentProvider>,
    emails_on: bool,
    r: &mut TickReport,
) -> Result<(), sqlx::Error> {
    // `balance_attempts` counts only *definitive* declines (see record_failure), so
    // capping on it stops hammering a hard-declined card every tick (~288×/day) while
    // still retrying transient/network failures indefinitely until arrival. After the
    // cap the customer settles via /espace (they got the dunning e-mail) or the admin
    // steps in — we never set payment_flag here, which would block that recovery path.
    //
    // Anti-double-charge: skip a booking that has a recent (<2 h) pending balance
    // payment — the customer is settling it in the browser (pay_balance), possibly
    // through 3DS. Once they finish, balance_paid_at is set; if they abandon, the
    // stale pending is ignored after 2 h and auto-charge resumes (negligible vs. the
    // J-14→arrival window). Prevents an off-session charge racing a concurrent on-
    // session one (two intents → two debits). The window is a heuristic, not a lock.
    let due = sqlx::query_as::<_, BalanceDue>(
        "select b.id, b.reference, b.balance_cents, b.provider_customer_id, \
                b.provider_payment_method_id, b.balance_attempts as attempts, b.emails_muted, \
                c.email, c.first_name, (b.balance_failed_notified_at is not null) as notified \
         from booking b join availability_week aw on aw.id = b.week_id \
         left join customer c on c.id = b.customer_id \
         where b.status = 'confirmed' and b.balance_paid_at is null and b.balance_cents > 0 \
           and b.payment_flag is null and b.channel = 'online' and b.balance_attempts < 3 \
           and b.provider_customer_id is not null and b.provider_payment_method_id is not null \
           and aw.start_date - 14 <= current_date and aw.start_date >= current_date \
           and not exists (select 1 from payment p where p.booking_id = b.id \
               and p.type = 'balance' and p.status = 'pending' \
               and p.created_at > now() - interval '2 hours')",
    )
    .fetch_all(pool)
    .await?;

    for d in due {
        // Key advances only on genuine (definitive) retries: a transient network
        // error keeps the same key so a lost-but-applied charge replays safely.
        match payments
            .charge_off_session(
                &d.provider_customer_id,
                &d.provider_payment_method_id,
                d.balance_cents,
                &format!("balance-{}-{}", d.id, d.attempts),
            )
            .await
        {
            Ok(intent_id) => {
                let mut tx = pool.begin().await?;
                sqlx::query(
                    "insert into payment (booking_id, type, provider, provider_intent_id, amount_cents, status) \
                     values ($1, 'balance', $2, $3, $4, 'succeeded')",
                )
                .bind(d.id)
                .bind(payments.name())
                .bind(&intent_id)
                .bind(d.balance_cents)
                .execute(&mut *tx)
                .await?;
                sqlx::query(
                    "update booking set status = 'balance_paid', balance_intent_id = $2, \
                        balance_paid_at = now(), balance_last_error = null, updated_at = now() \
                     where id = $1",
                )
                .bind(d.id)
                .bind(&intent_id)
                .execute(&mut *tx)
                .await?;
                tx.commit().await?;
                r.balances_charged += 1;
                tracing::info!("solde prélevé: {} ({} c)", d.reference, d.balance_cents);
                if let Some(to) = d
                    .email
                    .clone()
                    .filter(|e| !e.is_empty() && emails_on && !d.emails_muted)
                {
                    let vars = vec![
                        ("bonjour", email::bonjour(d.first_name.as_deref())),
                        ("prenom", d.first_name.clone().unwrap_or_default()),
                        ("montant", eur(d.balance_cents)),
                        ("reference", d.reference.clone()),
                    ];
                    email::send_system(
                        pool.clone(),
                        Some(d.id),
                        "balance_paid",
                        to,
                        &vars,
                        &format!("{}/espace", email::front_url()),
                    )
                    .await?;
                }
            }
            Err(e) => {
                r.balance_failures += 1;
                let definitive = e.is_definitive();
                record_failure(pool, d.id, "balance", definitive, &format!("{e:?}")).await?;
                if definitive && !d.notified && emails_on && !d.emails_muted {
                    notify_payment_issue(
                        pool,
                        d.id,
                        "balance",
                        d.email,
                        d.first_name,
                        &d.reference,
                    )
                    .await;
                }
                tracing::warn!(
                    "échec solde {} (définitif={definitive}, tentative {}): {e:?}",
                    d.reference,
                    d.attempts
                );
            }
        }
    }
    Ok(())
}

#[derive(FromRow)]
struct PrenotifyRow {
    id: Uuid,
    reference: String,
    balance_cents: i64,
    due_label: String,
    email: Option<String>,
    first_name: Option<String>,
}

/// A few days before the automatic balance charge (J-14), warn the customer so
/// they can check their card or pay early — cuts down SCA failures. Sent once.
#[derive(FromRow)]
struct AutomationDue {
    automation_id: Uuid,
    subject: String,
    body: String,
    recipient_email: String,
    booking_id: Uuid,
    reference: String,
    week_range: String,
    arrival: String,
    end_date: chrono::NaiveDate,
    total_cents: i64,
    deposit_cents: i64,
    balance_cents: i64,
    email: Option<String>,
    first_name: Option<String>,
    last_name: Option<String>,
    arrival_instructions: String,
}

/// Données d'un dossier pour les gabarits transactionnels.
pub(crate) struct TemplateBooking<'a> {
    pub first_name: Option<&'a str>,
    pub last_name: Option<&'a str>,
    pub reference: &'a str,
    pub week_range: &'a str,
    pub arrival: &'a str,
    pub end_date: chrono::NaiveDate,
    pub total_cents: i64,
    pub deposit_cents: i64,
    pub balance_cents: i64,
    pub arrival_instructions: &'a str,
}

/// Jeu de variables {{...}} d'un dossier pour les gabarits transactionnels.
pub(crate) fn booking_vars(b: &TemplateBooking) -> Vec<(&'static str, String)> {
    vec![
        ("prenom", b.first_name.unwrap_or_default().to_string()),
        ("nom", b.last_name.unwrap_or_default().to_string()),
        ("reference", b.reference.to_string()),
        ("semaine", b.week_range.to_string()),
        ("arrivee", b.arrival.to_string()),
        ("depart", b.end_date.format("%d/%m/%Y").to_string()),
        ("total", eur(b.total_cents)),
        ("acompte", eur(b.deposit_cents)),
        ("solde", eur(b.balance_cents)),
        // Les consignes d'accès sont du HTML riche (éditeur admin) ; dans les
        // e-mails texte la variable {{acces}} est aplatie en texte brut.
        ("acces", email::html_to_text(b.arrival_instructions)),
    ]
}

/// Moteur des transactionnels éditables : pour chaque automatisation active,
/// envoie l'e-mail aux dossiers dont la date d'événement + offset est atteinte.
/// Garde-fous : une seule fois par (automatisation, dossier) ; pas de
/// rétroactif antérieur à la création de l'automatisation ; fenêtre de grâce
/// de 3 jours au-delà de laquelle un envoi manqué est abandonné.
async fn run_email_automations(pool: &PgPool, r: &mut TickReport) -> Result<(), sqlx::Error> {
    let due: Vec<AutomationDue> = sqlx::query_as(
        "select a.id as automation_id, a.subject, a.body, a.recipient_email, \
                b.id as booking_id, b.reference, aw.range_label as week_range, \
                aw.arrival_label as arrival, aw.end_date, \
                b.total_cents, b.deposit_cents, b.balance_cents, \
                c.email, c.first_name, c.last_name, p.arrival_instructions \
         from email_automation a \
         join booking b on (a.channel = 'all' or b.channel = a.channel) \
           and case when a.event = 'cancellation' then b.status = 'cancelled' \
                    else b.status in ('confirmed','balance_paid') end \
         join availability_week aw on aw.id = b.week_id \
         join property p on p.id = b.property_id \
         left join customer c on c.id = b.customer_id \
         cross join lateral (select case a.event \
                when 'reservation' then coalesce(b.deposit_paid_at::date, b.created_at::date) \
                when 'arrival' then aw.start_date \
                when 'departure' then aw.end_date \
                else b.cancelled_at::date end as event_date) ev \
         where a.active \
           and not b.emails_muted \
           and ev.event_date is not null \
           and ev.event_date + a.offset_days <= current_date \
           and current_date <= ev.event_date + a.offset_days + 3 \
           and ev.event_date + a.offset_days >= a.created_at::date \
           and not exists (select 1 from email_automation_send s \
                           where s.automation_id = a.id and s.booking_id = b.id)",
    )
    .fetch_all(pool)
    .await?;

    let (site, location) = email::brand(pool).await;
    for d in due {
        // Mark first (idempotent even if the e-mail send is best-effort).
        let inserted = sqlx::query(
            "insert into email_automation_send (automation_id, booking_id) values ($1, $2) \
             on conflict do nothing",
        )
        .bind(d.automation_id)
        .bind(d.booking_id)
        .execute(pool)
        .await?;
        if inserted.rows_affected() == 0 {
            continue;
        }
        r.automations_sent += 1;

        // Destinataires fixes (prestataires, séparés par des virgules) si
        // renseignés, sinon le client du dossier.
        let fixed = !d.recipient_email.trim().is_empty();
        let recipients: Vec<String> = if fixed {
            d.recipient_email
                .split(',')
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(String::from)
                .collect()
        } else {
            match d.email.clone().filter(|e| !e.is_empty()) {
                Some(e) => vec![e],
                None => continue,
            }
        };
        let mut vars = booking_vars(&TemplateBooking {
            first_name: d.first_name.as_deref(),
            last_name: d.last_name.as_deref(),
            reference: &d.reference,
            week_range: &d.week_range,
            arrival: &d.arrival,
            end_date: d.end_date,
            total_cents: d.total_cents,
            deposit_cents: d.deposit_cents,
            balance_cents: d.balance_cents,
            arrival_instructions: &d.arrival_instructions,
        });
        vars.push(("site", site.clone()));
        let subject = email::render_template(&d.subject, &vars, false);
        let body = email::render_email_body(&d.body, &vars);
        // Le CTA « Mon espace » n'a de sens que pour le client du dossier.
        let (cta_label, cta_url) = if fixed {
            ("", String::new())
        } else {
            ("Mon espace", format!("{}/espace", email::front_url()))
        };
        let html = email::template(&site, &location, &subject, &body, cta_label, &cta_url);
        for to in recipients {
            email::spawn(
                pool.clone(),
                Some(d.booking_id),
                "automation",
                to,
                subject.clone(),
                html.clone(),
            );
        }
    }
    if r.automations_sent > 0 {
        tracing::info!(
            "{} transactionnel(s) automatique(s) envoyé(s)",
            r.automations_sent
        );
    }
    Ok(())
}

async fn prenotify_balances(pool: &PgPool, r: &mut TickReport) -> Result<(), sqlx::Error> {
    // Fires in the 3-day window before the charge opens (start_date-17 .. -15).
    let due: Vec<PrenotifyRow> = sqlx::query_as(
        "select b.id, b.reference, b.balance_cents, aw.balance_due_label as due_label, \
                c.email, c.first_name \
         from booking b join availability_week aw on aw.id = b.week_id \
         left join customer c on c.id = b.customer_id \
         where b.status = 'confirmed' and b.balance_paid_at is null and b.balance_cents > 0 \
           and b.payment_flag is null and b.balance_prenotified_at is null \
           and b.channel = 'online' \
           and not b.emails_muted \
           and aw.start_date - 17 <= current_date and current_date < aw.start_date - 14",
    )
    .fetch_all(pool)
    .await?;

    for d in due {
        // Mark first (idempotent even if the e-mail send is best-effort).
        sqlx::query(
            "update booking set balance_prenotified_at = now(), updated_at = now() where id = $1",
        )
        .bind(d.id)
        .execute(pool)
        .await?;
        r.balances_prenotified += 1;

        if let Some(to) = d.email.clone().filter(|e| !e.is_empty()) {
            let vars = vec![
                ("bonjour", email::bonjour(d.first_name.as_deref())),
                ("prenom", d.first_name.clone().unwrap_or_default()),
                ("montant", eur(d.balance_cents)),
                ("date", d.due_label.clone()),
                ("reference", d.reference.clone()),
            ];
            email::send_system(
                pool.clone(),
                Some(d.id),
                "balance_prenotify",
                to,
                &vars,
                &format!("{}/espace", email::front_url()),
            )
            .await?;
        }
    }
    if r.balances_prenotified > 0 {
        tracing::info!(
            "{} pré-notification(s) de solde envoyée(s)",
            r.balances_prenotified
        );
    }
    Ok(())
}

/// Record an automatic-payment failure: advance the attempt counter (only on a
/// definitive rejection, so the idempotency key changes for the next real retry)
/// and store the last error for admin visibility.
async fn record_failure(
    pool: &PgPool,
    booking_id: Uuid,
    kind: &str,
    definitive: bool,
    err: &str,
) -> Result<(), sqlx::Error> {
    let inc = if definitive { 1 } else { 0 };
    let sql = format!(
        "update booking set {kind}_attempts = {kind}_attempts + $2, \
            {kind}_last_error = $3, updated_at = now() where id = $1"
    );
    sqlx::query(&sql)
        .bind(booking_id)
        .bind(inc)
        .bind(err)
        .execute(pool)
        .await?;
    Ok(())
}

/// One-time dunning e-mail to the customer when an automatic charge is definitively
/// refused (e.g. card declined / authentication required). Guarded by the
/// `{kind}_failed_notified_at` marker so it is sent at most once.
async fn notify_payment_issue(
    pool: &PgPool,
    booking_id: Uuid,
    kind: &str,
    email: Option<String>,
    first_name: Option<String>,
    reference: &str,
) {
    let marker = format!("update booking set {kind}_failed_notified_at = now() where id = $1");
    if sqlx::query(&marker)
        .bind(booking_id)
        .execute(pool)
        .await
        .is_err()
    {
        return;
    }
    let Some(mail) = email.filter(|m| !m.trim().is_empty()) else {
        return;
    };
    let what = if kind == "balance" {
        "le prélèvement du solde de votre séjour"
    } else {
        "une opération de paiement de votre séjour"
    };
    let vars = vec![
        ("bonjour", email::bonjour(first_name.as_deref())),
        ("prenom", first_name.clone().unwrap_or_default()),
        ("operation", what.to_string()),
        ("reference", reference.to_string()),
    ];
    let _ = email::send_system(
        pool.clone(),
        Some(booking_id),
        "payment_issue",
        mail,
        &vars,
        &format!("{}/espace", email::front_url()),
    )
    .await;
}

#[derive(sqlx::FromRow)]
struct CartRow {
    id: Uuid,
    email: String,
    first_name: String,
}

async fn remind_abandoned_carts(pool: &PgPool, r: &mut TickReport) -> Result<(), sqlx::Error> {
    // Mark all stale carts as reminded; only those with a contact e-mail get one.
    let carts: Vec<CartRow> = sqlx::query_as(
        "with updated as ( \
            update booking set cart_reminder_sent_at = now(), updated_at = now() \
            where status = 'cart' and cart_reminder_sent_at is null \
              and not emails_muted \
              and created_at < now() - interval '1 hour' \
            returning id, customer_id ) \
         select u.id, c.email, c.first_name \
         from updated u join customer c on c.id = u.customer_id \
         where coalesce(c.email, '') <> ''",
    )
    .fetch_all(pool)
    .await?;

    for cart in carts {
        let vars = vec![
            ("bonjour", email::bonjour(Some(&cart.first_name))),
            ("prenom", cart.first_name.clone()),
        ];
        email::send_system(
            pool.clone(),
            Some(cart.id),
            "cart_reminder",
            cart.email,
            &vars,
            &format!("{}/reserver", email::front_url()),
        )
        .await?;
        r.carts_reminded += 1;
    }
    Ok(())
}

#[derive(sqlx::FromRow)]
struct StaleCartRow {
    id: Uuid,
    deposit_intent_id: Option<String>,
}

/// Expire carts abandoned for more than 48 h: mark them 'expired' and cancel any
/// dangling deposit PaymentIntent (a cart never blocks a week, but its unconfirmed
/// intent would otherwise stay open on Stripe forever, and rows accumulate).
async fn expire_stale_carts(
    pool: &PgPool,
    payments: &Arc<dyn PaymentProvider>,
    r: &mut TickReport,
) -> Result<(), sqlx::Error> {
    let stale: Vec<StaleCartRow> = sqlx::query_as(
        "update booking set status = 'expired', updated_at = now() \
         where status = 'cart' and created_at < now() - interval '48 hours' \
         returning id, deposit_intent_id",
    )
    .fetch_all(pool)
    .await?;

    for c in stale {
        if let Some(intent) = c.deposit_intent_id.as_deref().filter(|s| !s.is_empty()) {
            // Best-effort: an unconfirmed deposit intent can be safely cancelled
            // (a succeeded one would have moved the booking to 'confirmed').
            let idem = format!("cancel-cart-{}", c.id);
            if let Err(e) = payments.release(intent, &idem).await {
                tracing::warn!("annulation intent panier expiré {} échouée: {e:?}", c.id);
            }
        }
        r.carts_expired += 1;
    }
    if r.carts_expired > 0 {
        tracing::info!("{} panier(s) abandonné(s) expiré(s)", r.carts_expired);
    }
    Ok(())
}

#[derive(sqlx::FromRow)]
struct ReviewDue {
    id: Uuid,
    week_range: String,
    email: String,
    first_name: Option<String>,
}

/// Après le départ, demande un avis au client (une seule fois) : jeton
/// capability + e-mail système avec le lien /avis/{token}. Fenêtre de grâce
/// de 7 jours — au-delà, une demande manquée n'est plus envoyée (anti-
/// rétroactif au déploiement de la feature). Les dossiers annulés, flaggés
/// ou sans e-mail sont ignorés.
async fn request_reviews(pool: &PgPool, r: &mut TickReport) -> Result<(), sqlx::Error> {
    // Avis débranchés dans les réglages → aucune demande n'est envoyée.
    let enabled: bool =
        sqlx::query_scalar("select coalesce(bool_and(reviews_enabled), true) from property")
            .fetch_one(pool)
            .await?;
    if !enabled {
        return Ok(());
    }
    let due: Vec<ReviewDue> = sqlx::query_as(
        "select b.id, aw.range_label as week_range, c.email, c.first_name \
         from booking b \
         join availability_week aw on aw.id = b.week_id \
         join customer c on c.id = b.customer_id \
         where b.status in ('confirmed','balance_paid') and b.payment_flag is null \
           and b.review_requested_at is null \
           and coalesce(c.email, '') <> '' \
           and not b.emails_muted \
           and aw.end_date <= current_date and current_date <= aw.end_date + 7",
    )
    .fetch_all(pool)
    .await?;

    for d in due {
        let token = crate::admin::new_token();
        // Marqueur d'abord (idempotent même si l'envoi est best-effort).
        let updated = sqlx::query(
            "update booking set review_token = $2, review_requested_at = now(), \
                updated_at = now() \
             where id = $1 and review_requested_at is null",
        )
        .bind(d.id)
        .bind(&token)
        .execute(pool)
        .await?;
        if updated.rows_affected() == 0 {
            continue;
        }
        r.reviews_requested += 1;

        let vars = vec![
            ("bonjour", email::bonjour(d.first_name.as_deref())),
            ("prenom", d.first_name.clone().unwrap_or_default()),
            ("semaine", d.week_range.clone()),
        ];
        email::send_system(
            pool.clone(),
            Some(d.id),
            "review_request",
            d.email,
            &vars,
            &format!("{}/avis/{token}", email::front_url()),
        )
        .await?;
    }
    if r.reviews_requested > 0 {
        tracing::info!("{} demande(s) d'avis envoyée(s)", r.reviews_requested);
    }
    Ok(())
}

/// Purge expired auth tokens (RGPD data minimisation): magic links past their
/// TTL, and session rows well past expiry. Live sessions are untouched (queries
/// already filter on expires_at > now()).
async fn purge_expired_tokens(pool: &PgPool, r: &mut TickReport) -> Result<(), sqlx::Error> {
    let mut purged = 0i64;
    purged += sqlx::query("delete from magic_link where expires_at < now() - interval '1 day'")
        .execute(pool)
        .await?
        .rows_affected() as i64;
    purged += sqlx::query("delete from customer_session where expires_at < now()")
        .execute(pool)
        .await?
        .rows_affected() as i64;
    purged += sqlx::query("delete from admin_session where expires_at < now()")
        .execute(pool)
        .await?
        .rows_affected() as i64;
    r.tokens_purged += purged;
    if purged > 0 {
        tracing::info!("{purged} jeton(s) expiré(s) purgé(s)");
    }
    Ok(())
}
