//! Transactional e-mail via Resend. If RESEND_API_KEY is unset, sends are
//! logged and skipped (dev without a key).

use serde_json::json;

pub fn front_url() -> String {
    std::env::var("FRONT_ORIGIN").unwrap_or_else(|_| "http://localhost:3000".into())
}

pub fn api_url() -> String {
    std::env::var("API_BASE_URL").unwrap_or_else(|_| "http://localhost:8080".into())
}

/// Send an e-mail. Fire-and-forget friendly (await, or spawn from the caller).
pub async fn send(to: &str, subject: &str, html: &str) {
    let key = match std::env::var("RESEND_API_KEY") {
        Ok(k) if !k.is_empty() => k,
        _ => {
            tracing::info!("email (pas de RESEND_API_KEY) → {to} : {subject}");
            return;
        }
    };
    let from = std::env::var("MAIL_FROM").unwrap_or_else(|_| "onboarding@resend.dev".into());
    let client = reqwest::Client::new();
    let res = client
        .post("https://api.resend.com/emails")
        .bearer_auth(&key)
        .json(&json!({ "from": from, "to": [to], "subject": subject, "html": html }))
        .send()
        .await;
    match res {
        Ok(r) if r.status().is_success() => tracing::info!("email envoyé → {to} : {subject}"),
        Ok(r) => {
            let code = r.status();
            let body = r.text().await.unwrap_or_default();
            tracing::error!("email échec ({code}) → {to} : {body}");
        }
        Err(e) => tracing::error!("email erreur → {to} : {e}"),
    }
}

/// Spawn a send so it never blocks the request path.
pub fn spawn(to: String, subject: String, html: String) {
    tokio::spawn(async move { send(&to, &subject, &html).await });
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
