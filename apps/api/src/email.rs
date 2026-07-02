//! Transactional e-mail via Resend. If RESEND_API_KEY is unset, sends are
//! logged and skipped (dev without a key). Every send is journaled in `email_log`
//! for the reservation file (id Resend, statut, ouverture via webhook).

use serde_json::json;
use sqlx::postgres::PgPool;
use uuid::Uuid;

pub fn front_url() -> String {
    std::env::var("FRONT_ORIGIN").unwrap_or_else(|_| "http://localhost:3000".into())
}

pub fn api_url() -> String {
    std::env::var("API_BASE_URL").unwrap_or_else(|_| "http://localhost:8080".into())
}

/// Outcome of a send: Ok(Some(id)) delivered to Resend with an id, Ok(None) when
/// skipped (no key, dev), Err(msg) on failure.
enum SendOutcome {
    Sent(Option<String>),
    Failed(String),
}

/// Result of one Resend attempt: retryable (network/429/5xx) vs permanent (4xx —
/// a retry won't help, e.g. invalid recipient).
enum Attempt {
    Sent(Option<String>),
    Retry(String),
    Permanent(String),
}

async fn send_once(
    client: &reqwest::Client,
    key: &str,
    from: &str,
    to: &str,
    subject: &str,
    html: &str,
) -> Attempt {
    let res = client
        .post("https://api.resend.com/emails")
        .bearer_auth(key)
        .json(&json!({ "from": from, "to": [to], "subject": subject, "html": html }))
        .send()
        .await;
    match res {
        Ok(r) if r.status().is_success() => {
            let body: serde_json::Value = r.json().await.unwrap_or_default();
            Attempt::Sent(body.get("id").and_then(|v| v.as_str()).map(String::from))
        }
        Ok(r) => {
            let code = r.status();
            let body = r.text().await.unwrap_or_default();
            let msg = format!("HTTP {code}: {body}");
            // 429 (rate limit) and 5xx are transient; other 4xx are permanent.
            if code.as_u16() == 429 || code.is_server_error() {
                Attempt::Retry(msg)
            } else {
                Attempt::Permanent(msg)
            }
        }
        Err(e) => Attempt::Retry(e.to_string()), // network / timeout → retry
    }
}

async fn do_send(to: &str, subject: &str, html: &str) -> SendOutcome {
    let key = match std::env::var("RESEND_API_KEY") {
        Ok(k) if !k.is_empty() => k,
        _ => {
            tracing::info!("email (pas de RESEND_API_KEY) → {to} : {subject}");
            return SendOutcome::Sent(None);
        }
    };
    let from = std::env::var("MAIL_FROM").unwrap_or_else(|_| "onboarding@resend.dev".into());
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .unwrap_or_default();

    // Retry transient failures with backoff so a Resend hiccup doesn't silently
    // drop a transactional e-mail. Permanent (4xx) failures are not retried.
    let backoffs = [
        std::time::Duration::from_millis(500),
        std::time::Duration::from_millis(2000),
    ];
    let mut last_err = String::from("échec inconnu");
    for attempt in 0..=backoffs.len() {
        match send_once(&client, &key, &from, to, subject, html).await {
            Attempt::Sent(id) => {
                tracing::info!("email envoyé → {to} : {subject}");
                return SendOutcome::Sent(id);
            }
            Attempt::Permanent(msg) => {
                tracing::error!("email échec définitif → {to} : {msg}");
                return SendOutcome::Failed(msg);
            }
            Attempt::Retry(msg) => {
                last_err = msg;
                if attempt < backoffs.len() {
                    tracing::warn!(
                        "email tentative {} échouée ({last_err}), nouvel essai → {to}",
                        attempt + 1
                    );
                    tokio::time::sleep(backoffs[attempt]).await;
                }
            }
        }
    }
    tracing::error!("email échec après retries → {to} : {last_err}");
    SendOutcome::Failed(last_err)
}

/// Send and journal the e-mail (never blocks the caller). `booking_id`/`kind`
/// tie the row to the reservation file for the admin detail page.
pub fn spawn(
    pool: PgPool,
    booking_id: Option<Uuid>,
    kind: &str,
    to: String,
    subject: String,
    html: String,
) {
    let kind = kind.to_string();
    tokio::spawn(async move {
        let outcome = do_send(&to, &subject, &html).await;
        let (status, provider_id, error) = match outcome {
            SendOutcome::Sent(id) => ("sent", id, None),
            SendOutcome::Failed(e) => ("failed", None, Some(e)),
        };
        let _ = sqlx::query(
            "insert into email_log \
                (booking_id, recipient, kind, subject, provider_id, status, error, sent_at) \
             values ($1, $2, $3, $4, $5, $6, $7, case when $6 = 'sent' then now() else null end)",
        )
        .bind(booking_id)
        .bind(&to)
        .bind(&kind)
        .bind(&subject)
        .bind(&provider_id)
        .bind(status)
        .bind(&error)
        .execute(&pool)
        .await;
    });
}

/// Branded HTML wrapper with an optional call-to-action button.
pub fn template(heading: &str, body_html: &str, cta_label: &str, cta_url: &str) -> String {
    let cta = if cta_label.is_empty() {
        String::new()
    } else {
        format!(
            r#"<a href="{cta_url}" style="display:inline-block;margin-top:24px;padding:14px 26px;background:#1A1B1A;color:#ffffff;text-decoration:none;border-radius:12px;font:600 14px Helvetica,Arial,sans-serif">{cta_label}</a>"#
        )
    };
    format!(
        r#"<div style="background:#F5F4F1;padding:32px 0;font-family:Helvetica,Arial,sans-serif;color:#1A1B1A">
  <div style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #ececec;border-radius:18px;overflow:hidden">
    <div style="padding:24px 32px;border-bottom:1px solid #f0efec">
      <div style="font:400 24px Georgia,serif;letter-spacing:.02em">L'Adret</div>
    </div>
    <div style="padding:28px 32px">
      <h1 style="margin:0 0 14px;font:400 24px Georgia,serif">{heading}</h1>
      <div style="font:400 15px/1.65 Helvetica,Arial,sans-serif;color:#4a4c48">{body_html}</div>
      {cta}
    </div>
    <div style="padding:18px 32px;border-top:1px solid #f0efec;font:400 12px Helvetica,Arial,sans-serif;color:#9A9C97">
      L'Adret · Les Ménuires — cet e-mail vous est envoyé suite à votre démarche de réservation.
    </div>
  </div>
</div>"#
    )
}
