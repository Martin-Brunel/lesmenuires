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

// ---------------------------------------------------------------------------
// Gabarits : rendu {{variables}} partagé (transactionnels éditables et
// e-mails système) + registre des e-mails système personnalisables.
// ---------------------------------------------------------------------------

/// Substitue les variables {{...}} d'un gabarit. `escape` = true pour un corps
/// HTML (les valeurs viennent des données client), false pour un sujet texte.
pub(crate) fn render_template(tpl: &str, vars: &[(&str, String)], escape: bool) -> String {
    let mut out = tpl.to_string();
    for (key, value) in vars {
        let v = if escape {
            value
                .replace('&', "&amp;")
                .replace('<', "&lt;")
                .replace('>', "&gt;")
        } else {
            value.clone()
        };
        out = out.replace(&format!("{{{{{key}}}}}"), &v);
    }
    out
}

/// Corps d'un e-mail à gabarit : variables substituées (échappées), HTML admin
/// autorisé mais sanitisé (`style` conservé). Sans balise, les retours à la
/// ligne deviennent des <br>.
pub(crate) fn render_email_body(tpl: &str, vars: &[(&str, String)]) -> String {
    let rendered = render_template(tpl, vars, true);
    let html = if rendered.contains('<') {
        rendered
    } else {
        rendered.replace('\n', "<br>")
    };
    ammonia::Builder::default()
        .add_generic_attributes(&["style"])
        .clean(&html)
        .to_string()
}

/// Un e-mail système personnalisable : gabarit par défaut + métadonnées UI.
pub(crate) struct SystemTemplate {
    pub kind: &'static str,
    pub label: &'static str,
    pub trigger: &'static str,
    pub subject: &'static str,
    pub body: &'static str,
    pub cta_label: &'static str,
    pub vars: &'static [&'static str],
}

pub(crate) const SYSTEM_TEMPLATES: &[SystemTemplate] = &[
    SystemTemplate {
        kind: "welcome",
        label: "Confirmation de réservation",
        trigger: "Envoyé au client dès que l'acompte est réglé.",
        subject: "Votre réservation est confirmée — L'Adret",
        body: "{{bonjour}}\n\nVotre réservation {{reference}} est confirmée — merci de votre confiance. Retrouvez le détail de votre séjour, les échéances de paiement et les consignes d'arrivée dans votre espace personnel.",
        cta_label: "Accéder à mon espace",
        vars: &["bonjour", "prenom", "reference"],
    },
    SystemTemplate {
        kind: "balance_prenotify",
        label: "Prélèvement du solde à venir",
        trigger: "Envoyé ~16 jours avant l'arrivée, avant le prélèvement automatique (J-14).",
        subject: "Prélèvement du solde à venir — L'Adret",
        body: "{{bonjour}}\n\nLe solde de votre séjour à L'Adret, soit {{montant}}, sera prélevé automatiquement le {{date}} sur la carte enregistrée lors de votre réservation {{reference}}.\n\nVous n'avez rien à faire : assurez-vous simplement que votre carte est toujours valide. Vous pouvez aussi régler le solde dès maintenant depuis votre espace.",
        cta_label: "Voir ma réservation",
        vars: &["bonjour", "prenom", "montant", "date", "reference"],
    },
    SystemTemplate {
        kind: "balance_paid",
        label: "Solde réglé",
        trigger: "Envoyé quand le solde a été prélevé avec succès.",
        subject: "Solde réglé — L'Adret",
        body: "{{bonjour}}\n\nLe solde de votre séjour à L'Adret ({{montant}}) vient d'être prélevé sur votre moyen de paiement enregistré. Votre réservation {{reference}} est entièrement réglée.\n\nAucune caution n'est prélevée : votre carte reste simplement enregistrée et ne serait débitée qu'en cas de dégâts constatés à l'état des lieux de sortie.",
        cta_label: "Voir ma réservation",
        vars: &["bonjour", "prenom", "montant", "reference"],
    },
    SystemTemplate {
        kind: "payment_issue",
        label: "Incident de paiement",
        trigger: "Envoyé quand un prélèvement automatique échoue définitivement.",
        subject: "Action requise sur votre réservation — L'Adret",
        body: "{{bonjour}}\n\nNous n'avons pas pu effectuer {{operation}} (réservation {{reference}}). Votre banque a peut-être refusé l'opération ou une confirmation est nécessaire. Merci de nous contacter ou de vérifier votre moyen de paiement depuis votre espace afin de finaliser votre réservation.",
        cta_label: "Mon espace",
        vars: &["bonjour", "prenom", "operation", "reference"],
    },
    SystemTemplate {
        kind: "cart_reminder",
        label: "Relance panier",
        trigger: "Envoyé au client qui a commencé une réservation sans la finaliser.",
        subject: "Votre réservation vous attend — L'Adret",
        body: "{{bonjour}}\n\nVous avez commencé une réservation à L'Adret sans la finaliser. Votre sélection vous attend — il ne reste que le règlement de l'acompte pour la confirmer.",
        cta_label: "Finaliser ma réservation",
        vars: &["bonjour", "prenom"],
    },
    SystemTemplate {
        kind: "cancellation",
        label: "Annulation",
        trigger: "Envoyé au client quand sa réservation est annulée.",
        subject: "Annulation de votre réservation — L'Adret",
        body: "{{bonjour}}\n\nVotre réservation {{reference}} (semaine {{semaine}}) à L'Adret a bien été annulée.{{remboursement}}\n\nPour toute question, répondez simplement à cet e-mail.",
        cta_label: "",
        vars: &["bonjour", "reference", "semaine", "remboursement"],
    },
    SystemTemplate {
        kind: "review_request",
        label: "Demande d'avis",
        trigger: "Envoyé au client après son départ, pour recueillir son avis sur le séjour.",
        subject: "Comment s'est passé votre séjour ? — L'Adret",
        body: "{{bonjour}}\n\nNous espérons que votre séjour à L'Adret (semaine {{semaine}}) s'est bien passé. Votre avis compte beaucoup : il aide les prochains voyageurs et nous permet de nous améliorer. Cela ne prend qu'une minute.",
        cta_label: "Laisser un avis",
        vars: &["bonjour", "prenom", "semaine"],
    },
    SystemTemplate {
        kind: "contract_request",
        label: "Contrat à signer",
        trigger: "Envoyé depuis un dossier (résa manuelle) pour faire signer le contrat en ligne.",
        subject: "Votre contrat de location à signer — L'Adret",
        body: "{{bonjour}}\n\nVotre contrat de location pour la semaine du {{semaine}} à L'Adret est prêt. Merci de le lire et de le signer en ligne — cela ne prend qu'une minute. Ce lien restera ensuite accessible comme copie de votre contrat signé.",
        cta_label: "Lire et signer le contrat",
        vars: &["bonjour", "prenom", "semaine"],
    },
];

/// Envoie un e-mail système : override admin s'il existe, gabarit par défaut
/// sinon. `cta_url` vide = pas de bouton.
pub(crate) async fn send_system(
    pool: sqlx::PgPool,
    booking_id: Option<uuid::Uuid>,
    kind: &str,
    to: String,
    vars: &[(&str, String)],
    cta_url: &str,
) -> Result<(), sqlx::Error> {
    let def = SYSTEM_TEMPLATES
        .iter()
        .find(|t| t.kind == kind)
        .expect("e-mail système inconnu");
    let ovr: Option<(String, String)> =
        sqlx::query_as("select subject, body from email_template_override where kind = $1")
            .bind(kind)
            .fetch_optional(&pool)
            .await?;
    let (subject_tpl, body_tpl) = ovr
        .as_ref()
        .map(|(s, b)| (s.as_str(), b.as_str()))
        .unwrap_or((def.subject, def.body));
    let subject = render_template(subject_tpl, vars, false);
    let body = render_email_body(body_tpl, vars);
    // Le titre dans le gabarit visuel reprend le sujet, sans le suffixe marque.
    let heading = subject.trim_end_matches(" — L'Adret").to_string();
    let (label, url) = if cta_url.is_empty() {
        ("", "")
    } else {
        (def.cta_label, cta_url)
    };
    let html = template(&heading, &body, label, url);
    spawn(pool, booking_id, kind, to, subject, html);
    Ok(())
}

/// « Bonjour Camille, » / « Bonjour, » — variable {{bonjour}} des gabarits.
pub(crate) fn bonjour(first_name: Option<&str>) -> String {
    match first_name.map(str::trim).filter(|s| !s.is_empty()) {
        Some(n) => format!("Bonjour {n},"),
        None => "Bonjour,".to_string(),
    }
}
