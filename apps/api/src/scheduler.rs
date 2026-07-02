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
fn eur(cents: i64) -> String {
    format!("{},{:02} €", cents / 100, (cents % 100).abs())
}

fn greeting(first_name: Option<&str>) -> String {
    match first_name.map(str::trim).filter(|s| !s.is_empty()) {
        Some(name) => format!("Bonjour {name},"),
        None => "Bonjour,".to_string(),
    }
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
            > 0
    }
}

pub async fn run_tick(pool: &PgPool, payments: &Arc<dyn PaymentProvider>) -> TickReport {
    let mut r = TickReport::default();
    if let Err(e) = prenotify_balances(pool, &mut r).await {
        tracing::error!("job pré-notif solde: {e:?}");
    }
    if let Err(e) = charge_due_balances(pool, payments, &mut r).await {
        tracing::error!("job solde: {e:?}");
    }
    if let Err(e) = remind_abandoned_carts(pool, &mut r).await {
        tracing::error!("job relance: {e:?}");
    }
    if let Err(e) = expire_stale_carts(pool, payments, &mut r).await {
        tracing::error!("job expiration panier: {e:?}");
    }
    if let Err(e) = purge_expired_tokens(pool, &mut r).await {
        tracing::error!("job purge jetons: {e:?}");
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
    email: Option<String>,
    first_name: Option<String>,
    notified: bool,
}

async fn charge_due_balances(
    pool: &PgPool,
    payments: &Arc<dyn PaymentProvider>,
    r: &mut TickReport,
) -> Result<(), sqlx::Error> {
    // `balance_attempts` counts only *definitive* declines (see record_failure), so
    // capping on it stops hammering a hard-declined card every tick (~288×/day) while
    // still retrying transient/network failures indefinitely until arrival. After the
    // cap the customer settles via /espace (they got the dunning e-mail) or the admin
    // steps in — we never set payment_flag here, which would block that recovery path.
    let due = sqlx::query_as::<_, BalanceDue>(
        "select b.id, b.reference, b.balance_cents, b.provider_customer_id, \
                b.provider_payment_method_id, b.balance_attempts as attempts, \
                c.email, c.first_name, (b.balance_failed_notified_at is not null) as notified \
         from booking b join availability_week aw on aw.id = b.week_id \
         left join customer c on c.id = b.customer_id \
         where b.status = 'confirmed' and b.balance_paid_at is null and b.balance_cents > 0 \
           and b.payment_flag is null and b.channel = 'online' and b.balance_attempts < 3 \
           and b.provider_customer_id is not null and b.provider_payment_method_id is not null \
           and aw.start_date - 14 <= current_date and aw.start_date >= current_date",
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
                if let Some(to) = d.email.clone().filter(|e| !e.is_empty()) {
                    let body = format!(
                        "{}<br><br>Le solde de votre séjour à L'Adret ({}) vient d'être prélevé \
                         sur votre moyen de paiement enregistré. Votre réservation {} est \
                         entièrement réglée.<br><br>Aucune caution n'est prélevée : votre carte \
                         reste simplement enregistrée et ne serait débitée qu'en cas de dégâts \
                         constatés à l'état des lieux de sortie.",
                        greeting(d.first_name.as_deref()),
                        eur(d.balance_cents),
                        d.reference,
                    );
                    let html = email::template(
                        "Solde réglé",
                        &body,
                        "Voir ma réservation",
                        &format!("{}/espace", email::front_url()),
                    );
                    email::spawn(
                        pool.clone(),
                        Some(d.id),
                        "balance_paid",
                        to,
                        "Solde réglé — L'Adret".into(),
                        html,
                    );
                }
            }
            Err(e) => {
                r.balance_failures += 1;
                let definitive = e.is_definitive();
                record_failure(pool, d.id, "balance", definitive, &format!("{e:?}")).await?;
                if definitive && !d.notified {
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
            let body = format!(
                "{}<br><br>Le solde de votre séjour à L'Adret, soit <strong>{}</strong>, sera \
                 prélevé automatiquement le {} sur la carte enregistrée lors de votre réservation \
                 {}.<br><br>Vous n'avez rien à faire : assurez-vous simplement que votre carte est \
                 toujours valide. Vous pouvez aussi régler le solde dès maintenant depuis votre espace.",
                greeting(d.first_name.as_deref()),
                eur(d.balance_cents),
                d.due_label,
                d.reference,
            );
            let html = email::template(
                "Prélèvement du solde à venir",
                &body,
                "Voir ma réservation",
                &format!("{}/espace", email::front_url()),
            );
            email::spawn(
                pool.clone(),
                Some(d.id),
                "balance_prenotify",
                to,
                "Prélèvement du solde à venir — L'Adret".into(),
                html,
            );
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
    let hello = match first_name {
        Some(f) if !f.trim().is_empty() => format!("Bonjour {f},"),
        _ => "Bonjour,".to_string(),
    };
    let what = if kind == "balance" {
        "le prélèvement du solde de votre séjour"
    } else {
        "une opération de paiement de votre séjour"
    };
    let body = format!(
        "{hello}<br><br>Nous n'avons pas pu effectuer {what} (réservation <b>{reference}</b>). \
         Votre banque a peut-être refusé l'opération ou une confirmation est nécessaire. \
         Merci de nous contacter ou de vérifier votre moyen de paiement depuis votre espace \
         afin de finaliser votre réservation."
    );
    let link = format!("{}/espace", email::front_url());
    let html = email::template(
        "Action requise sur votre réservation",
        &body,
        "Mon espace",
        &link,
    );
    email::spawn(
        pool.clone(),
        Some(booking_id),
        "payment_issue",
        mail,
        "Action requise sur votre réservation — L'Adret".into(),
        html,
    );
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
              and created_at < now() - interval '1 hour' \
            returning id, customer_id ) \
         select u.id, c.email, c.first_name \
         from updated u join customer c on c.id = u.customer_id \
         where coalesce(c.email, '') <> ''",
    )
    .fetch_all(pool)
    .await?;

    for cart in carts {
        let hello = if cart.first_name.trim().is_empty() {
            "Bonjour,".to_string()
        } else {
            format!("Bonjour {},", cart.first_name)
        };
        let body = format!(
            "{hello}<br><br>Vous avez commencé une réservation à L'Adret sans la finaliser. \
             Votre sélection vous attend — il ne reste que le règlement de l'acompte pour la confirmer."
        );
        let link = format!("{}/reserver", email::front_url());
        let html = email::template(
            "Votre réservation vous attend",
            &body,
            "Finaliser ma réservation",
            &link,
        );
        email::spawn(
            pool.clone(),
            Some(cart.id),
            "cart_reminder",
            cart.email,
            "Votre réservation vous attend — L'Adret".into(),
            html,
        );
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
