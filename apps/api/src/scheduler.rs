//! Background scheduler: automated money jobs driven by the payment provider.
//!
//! - Solde (balance) charged off-session at J-14 (two weeks before arrival),
//!   retried each tick until arrival if it fails.
//! - Caution authorized (manual-capture hold) at J-5.
//! - Abandoned-cart reminder marker (email à brancher).
//!
//! Cancelled bookings are never picked up (status filter), honouring the rule
//! "acompte gardé, solde non prélevé".

use crate::email;
use crate::payments::PaymentProvider;
use serde::Serialize;
use sqlx::postgres::PgPool;
use sqlx::FromRow;
use std::sync::Arc;
use uuid::Uuid;

#[derive(Default, Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TickReport {
    pub balances_charged: i64,
    pub balance_failures: i64,
    pub cautions_authorized: i64,
    pub caution_failures: i64,
    pub carts_reminded: i64,
}

impl TickReport {
    fn any(&self) -> bool {
        self.balances_charged
            + self.balance_failures
            + self.cautions_authorized
            + self.caution_failures
            + self.carts_reminded
            > 0
    }
}

pub async fn run_tick(pool: &PgPool, payments: &Arc<dyn PaymentProvider>) -> TickReport {
    let mut r = TickReport::default();
    if let Err(e) = charge_due_balances(pool, payments, &mut r).await {
        tracing::error!("job solde: {e:?}");
    }
    if let Err(e) = authorize_due_cautions(pool, payments, &mut r).await {
        tracing::error!("job caution: {e:?}");
    }
    if let Err(e) = remind_abandoned_carts(pool, &mut r).await {
        tracing::error!("job relance: {e:?}");
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
    let due = sqlx::query_as::<_, BalanceDue>(
        "select b.id, b.reference, b.balance_cents, b.provider_customer_id, \
                b.provider_payment_method_id, b.balance_attempts as attempts, \
                c.email, c.first_name, (b.balance_failed_notified_at is not null) as notified \
         from booking b join availability_week aw on aw.id = b.week_id \
         left join customer c on c.id = b.customer_id \
         where b.status = 'confirmed' and b.balance_paid_at is null and b.balance_cents > 0 \
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
        "l'empreinte de caution de votre séjour"
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
        mail,
        "Action requise sur votre réservation — L'Adret".into(),
        html,
    );
}

#[derive(FromRow)]
struct CautionDue {
    id: Uuid,
    reference: String,
    caution_cents: i64,
    provider_customer_id: String,
    provider_payment_method_id: String,
    attempts: i32,
    email: Option<String>,
    first_name: Option<String>,
    notified: bool,
}

async fn authorize_due_cautions(
    pool: &PgPool,
    payments: &Arc<dyn PaymentProvider>,
    r: &mut TickReport,
) -> Result<(), sqlx::Error> {
    let due = sqlx::query_as::<_, CautionDue>(
        "select b.id, b.reference, b.caution_cents, b.provider_customer_id, \
                b.provider_payment_method_id, b.caution_attempts as attempts, \
                c.email, c.first_name, (b.caution_failed_notified_at is not null) as notified \
         from booking b join availability_week aw on aw.id = b.week_id \
         left join customer c on c.id = b.customer_id \
         where b.status in ('confirmed', 'balance_paid') and b.caution_authorized_at is null \
           and b.caution_cents > 0 and b.provider_customer_id is not null \
           and b.provider_payment_method_id is not null \
           and aw.start_date - 5 <= current_date and aw.start_date >= current_date",
    )
    .fetch_all(pool)
    .await?;

    for d in due {
        match payments
            .authorize_hold(
                &d.provider_customer_id,
                &d.provider_payment_method_id,
                d.caution_cents,
                &format!("caution-{}-{}", d.id, d.attempts),
            )
            .await
        {
            Ok(intent_id) => {
                let mut tx = pool.begin().await?;
                sqlx::query(
                    "insert into payment (booking_id, type, provider, provider_intent_id, amount_cents, status) \
                     values ($1, 'caution_auth', $2, $3, $4, 'authorized')",
                )
                .bind(d.id)
                .bind(payments.name())
                .bind(&intent_id)
                .bind(d.caution_cents)
                .execute(&mut *tx)
                .await?;
                sqlx::query(
                    "update booking set caution_intent_id = $2, caution_authorized_at = now(), \
                        caution_last_error = null, updated_at = now() where id = $1",
                )
                .bind(d.id)
                .bind(&intent_id)
                .execute(&mut *tx)
                .await?;
                tx.commit().await?;
                r.cautions_authorized += 1;
                tracing::info!("caution autorisée: {} ({} c)", d.reference, d.caution_cents);
            }
            Err(e) => {
                r.caution_failures += 1;
                let definitive = e.is_definitive();
                record_failure(pool, d.id, "caution", definitive, &format!("{e:?}")).await?;
                if definitive && !d.notified {
                    notify_payment_issue(
                        pool,
                        d.id,
                        "caution",
                        d.email,
                        d.first_name,
                        &d.reference,
                    )
                    .await;
                }
                tracing::warn!(
                    "échec caution {} (définitif={definitive}, tentative {}): {e:?}",
                    d.reference,
                    d.attempts
                );
            }
        }
    }
    Ok(())
}

#[derive(sqlx::FromRow)]
struct CartRow {
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
            returning customer_id ) \
         select c.email, c.first_name \
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
            cart.email,
            "Votre réservation vous attend — L'Adret".into(),
            html,
        );
        r.carts_reminded += 1;
    }
    Ok(())
}
