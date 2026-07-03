//! Transactional e-mail via Resend. If RESEND_API_KEY is unset, sends are
//! logged and skipped (dev without a key). Every send is journaled in `email_log`
//! for the reservation file (id Resend, statut, ouverture via webhook).

use crate::i18n::Lang;
use serde_json::json;
use sqlx::postgres::PgPool;
use uuid::Uuid;

pub fn front_url() -> String {
    std::env::var("FRONT_ORIGIN").unwrap_or_else(|_| "http://localhost:3000".into())
}

/// URL du front dans la langue du destinataire (l'anglais vit sous /en).
pub fn front_url_lang(lang: Lang) -> String {
    match lang {
        Lang::Fr => front_url(),
        Lang::En => format!("{}/en", front_url()),
    }
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
    // Alternative texte : les e-mails HTML sans partie text/plain sont un
    // marqueur de spam courant chez Gmail/Outlook.
    let text = html_to_text(html);
    let res = client
        .post("https://api.resend.com/emails")
        .bearer_auth(key)
        .json(&json!({ "from": from, "to": [to], "subject": subject, "html": html, "text": text }))
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
/// Identité du site pour les e-mails : (nom, localisation), lus depuis la
/// propriété — la source de vérité, éditable dans l'admin (Éditorial). Le nom
/// n'est jamais codé en dur dans un e-mail.
pub(crate) async fn brand(pool: &sqlx::PgPool) -> (String, String) {
    sqlx::query_as::<_, (String, String)>("select name, location_label from property limit 1")
        .fetch_optional(pool)
        .await
        .ok()
        .flatten()
        .unwrap_or_else(|| ("Votre location".into(), String::new()))
}

pub fn template(
    brand_name: &str,
    brand_location: &str,
    heading: &str,
    body_html: &str,
    cta_label: &str,
    cta_url: &str,
) -> String {
    template_lang(
        brand_name,
        brand_location,
        heading,
        body_html,
        cta_label,
        cta_url,
        Lang::Fr,
    )
}

#[allow(clippy::too_many_arguments)]
pub fn template_lang(
    brand_name: &str,
    brand_location: &str,
    heading: &str,
    body_html: &str,
    cta_label: &str,
    cta_url: &str,
    lang: Lang,
) -> String {
    let cta = if cta_label.is_empty() {
        String::new()
    } else {
        format!(
            r#"<a href="{cta_url}" style="display:inline-block;margin-top:24px;padding:14px 26px;background:#1A1B1A;color:#ffffff;text-decoration:none;border-radius:12px;font:600 14px Helvetica,Arial,sans-serif">{cta_label}</a>"#
        )
    };
    let footer_brand = if brand_location.trim().is_empty() {
        brand_name.to_string()
    } else {
        format!("{brand_name} · {brand_location}")
    };
    let footer_note = match lang {
        Lang::Fr => "cet e-mail vous est envoyé suite à votre démarche de réservation.",
        Lang::En => "this e-mail is sent to you following your booking request.",
    };
    format!(
        r#"<div style="background:#F5F4F1;padding:32px 0;font-family:Helvetica,Arial,sans-serif;color:#1A1B1A">
  <div style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #ececec;border-radius:18px;overflow:hidden">
    <div style="padding:24px 32px;border-bottom:1px solid #f0efec">
      <div style="font:400 24px Georgia,serif;letter-spacing:.02em">{brand_name}</div>
    </div>
    <div style="padding:28px 32px">
      <h1 style="margin:0 0 14px;font:400 24px Georgia,serif">{heading}</h1>
      <div style="font:400 15px/1.65 Helvetica,Arial,sans-serif;color:#4a4c48">{body_html}</div>
      {cta}
    </div>
    <div style="padding:18px 32px;border-top:1px solid #f0efec;font:400 12px Helvetica,Arial,sans-serif;color:#9A9C97">
      {footer_brand} — {footer_note}
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

/// Un e-mail système personnalisable : gabarit par défaut (fr + en) +
/// métadonnées UI. L'override admin est stocké par (kind, locale) ; en son
/// absence, le gabarit par défaut de la langue du destinataire s'applique.
pub(crate) struct SystemTemplate {
    pub kind: &'static str,
    pub label: &'static str,
    pub trigger: &'static str,
    pub subject: &'static str,
    pub body: &'static str,
    pub subject_en: &'static str,
    pub body_en: &'static str,
    pub cta_label: &'static str,
    pub cta_label_en: &'static str,
    pub vars: &'static [&'static str],
}

impl SystemTemplate {
    fn subject_for(&self, lang: Lang) -> &'static str {
        match lang {
            Lang::Fr => self.subject,
            Lang::En => self.subject_en,
        }
    }
    fn body_for(&self, lang: Lang) -> &'static str {
        match lang {
            Lang::Fr => self.body,
            Lang::En => self.body_en,
        }
    }
    fn cta_label_for(&self, lang: Lang) -> &'static str {
        match lang {
            Lang::Fr => self.cta_label,
            Lang::En => self.cta_label_en,
        }
    }
}

pub(crate) const SYSTEM_TEMPLATES: &[SystemTemplate] = &[
    SystemTemplate {
        kind: "welcome",
        label: "Confirmation de réservation",
        trigger: "Envoyé au client dès que l'acompte est réglé.",
        subject: "Votre réservation est confirmée — {{site}}",
        body: "{{bonjour}}\n\nVotre réservation {{reference}} est confirmée — merci de votre confiance. Retrouvez le détail de votre séjour, les échéances de paiement et les consignes d'arrivée dans votre espace personnel.",
        subject_en: "Your booking is confirmed — {{site}}",
        body_en: "{{bonjour}}\n\nYour booking {{reference}} is confirmed — thank you for your trust. Find the details of your stay, the payment schedule and the arrival instructions in your personal account.",
        cta_label: "Accéder à mon espace",
        cta_label_en: "Go to my account",
        vars: &["bonjour", "prenom", "reference", "site"],
    },
    SystemTemplate {
        kind: "offline_pending",
        label: "Instructions de règlement (chèque/virement)",
        trigger: "Envoyé quand une réservation en ligne choisit le règlement par chèque ou virement.",
        subject: "Votre réservation est en attente de règlement — {{site}}",
        body: "{{bonjour}}\n\nVotre demande de réservation {{reference}} est bien enregistrée : la semaine est retenue pour vous.\n\nPour la confirmer définitivement, réglez l'acompte de {{montant}} par {{methode}} :\n\n{{instructions}}\n\nPensez à indiquer la référence {{reference}} avec votre règlement. Dès réception, nous validerons votre réservation et vous recevrez une confirmation.",
        subject_en: "Your booking is awaiting payment — {{site}}",
        body_en: "{{bonjour}}\n\nYour booking request {{reference}} has been recorded: the week is held for you.\n\nTo confirm it, pay the deposit of {{montant}} by {{methode}}:\n\n{{instructions}}\n\nPlease include the reference {{reference}} with your payment. Upon receipt, we will validate your booking and you will receive a confirmation.",
        cta_label: "Suivre ma réservation",
        cta_label_en: "Follow my booking",
        vars: &["bonjour", "prenom", "reference", "montant", "methode", "instructions", "site"],
    },
    SystemTemplate {
        kind: "balance_prenotify",
        label: "Prélèvement du solde à venir",
        trigger: "Envoyé ~16 jours avant l'arrivée, avant le prélèvement automatique (J-14).",
        subject: "Prélèvement du solde à venir — {{site}}",
        body: "{{bonjour}}\n\nLe solde de votre séjour à {{site}}, soit {{montant}}, sera prélevé automatiquement le {{date}} sur la carte enregistrée lors de votre réservation {{reference}}.\n\nVous n'avez rien à faire : assurez-vous simplement que votre carte est toujours valide. Vous pouvez aussi régler le solde dès maintenant depuis votre espace.",
        subject_en: "Upcoming balance charge — {{site}}",
        body_en: "{{bonjour}}\n\nThe balance of your stay at {{site}}, i.e. {{montant}}, will be charged automatically on {{date}} to the card registered with your booking {{reference}}.\n\nThere is nothing you need to do: just make sure your card is still valid. You can also pay the balance now from your account.",
        cta_label: "Voir ma réservation",
        cta_label_en: "View my booking",
        vars: &["bonjour", "prenom", "montant", "date", "reference", "site"],
    },
    SystemTemplate {
        kind: "balance_paid",
        label: "Solde réglé",
        trigger: "Envoyé quand le solde a été prélevé avec succès.",
        subject: "Solde réglé — {{site}}",
        body: "{{bonjour}}\n\nLe solde de votre séjour à {{site}} ({{montant}}) vient d'être prélevé sur votre moyen de paiement enregistré. Votre réservation {{reference}} est entièrement réglée.\n\nAucune caution n'est prélevée : votre carte reste simplement enregistrée et ne serait débitée qu'en cas de dégâts constatés à l'état des lieux de sortie.",
        subject_en: "Balance paid — {{site}}",
        body_en: "{{bonjour}}\n\nThe balance of your stay at {{site}} ({{montant}}) has just been charged to your registered payment method. Your booking {{reference}} is now fully paid.\n\nNo security deposit is charged: your card simply remains registered and would only be charged in case of damage recorded at the check-out inspection.",
        cta_label: "Voir ma réservation",
        cta_label_en: "View my booking",
        vars: &["bonjour", "prenom", "montant", "reference", "site"],
    },
    SystemTemplate {
        kind: "payment_issue",
        label: "Incident de paiement",
        trigger: "Envoyé quand un prélèvement automatique échoue définitivement.",
        subject: "Action requise sur votre réservation — {{site}}",
        body: "{{bonjour}}\n\nNous n'avons pas pu effectuer {{operation}} (réservation {{reference}}). Votre banque a peut-être refusé l'opération ou une confirmation est nécessaire. Merci de nous contacter ou de vérifier votre moyen de paiement depuis votre espace afin de finaliser votre réservation.",
        subject_en: "Action required on your booking — {{site}}",
        body_en: "{{bonjour}}\n\nWe could not process {{operation}} (booking {{reference}}). Your bank may have declined the operation or a confirmation is required. Please contact us or check your payment method from your account to finalise your booking.",
        cta_label: "Mon espace",
        cta_label_en: "My account",
        vars: &["bonjour", "prenom", "operation", "reference", "site"],
    },
    SystemTemplate {
        kind: "cart_reminder",
        label: "Relance panier",
        trigger: "Envoyé au client qui a commencé une réservation sans la finaliser.",
        subject: "Votre réservation vous attend — {{site}}",
        body: "{{bonjour}}\n\nVous avez commencé une réservation à {{site}} sans la finaliser. Votre sélection vous attend — il ne reste que le règlement de l'acompte pour la confirmer.",
        subject_en: "Your booking is waiting for you — {{site}}",
        body_en: "{{bonjour}}\n\nYou started a booking at {{site}} without finishing it. Your selection is waiting for you — only the deposit payment is left to confirm it.",
        cta_label: "Finaliser ma réservation",
        cta_label_en: "Finish my booking",
        vars: &["bonjour", "prenom", "site"],
    },
    SystemTemplate {
        kind: "cancellation",
        label: "Annulation",
        trigger: "Envoyé au client quand sa réservation est annulée.",
        subject: "Annulation de votre réservation — {{site}}",
        body: "{{bonjour}}\n\nVotre réservation {{reference}} (semaine {{semaine}}) à {{site}} a bien été annulée.{{remboursement}}\n\nPour toute question, répondez simplement à cet e-mail.",
        subject_en: "Cancellation of your booking — {{site}}",
        body_en: "{{bonjour}}\n\nYour booking {{reference}} (week {{semaine}}) at {{site}} has been cancelled.{{remboursement}}\n\nFor any question, simply reply to this e-mail.",
        cta_label: "",
        cta_label_en: "",
        vars: &["bonjour", "reference", "semaine", "remboursement", "site"],
    },
    SystemTemplate {
        kind: "review_request",
        label: "Demande d'avis",
        trigger: "Envoyé au client après son départ, pour recueillir son avis sur le séjour.",
        subject: "Comment s'est passé votre séjour ? — {{site}}",
        body: "{{bonjour}}\n\nNous espérons que votre séjour à {{site}} (semaine {{semaine}}) s'est bien passé. Votre avis compte beaucoup : il aide les prochains voyageurs et nous permet de nous améliorer. Cela ne prend qu'une minute.",
        subject_en: "How was your stay? — {{site}}",
        body_en: "{{bonjour}}\n\nWe hope your stay at {{site}} (week {{semaine}}) went well. Your review matters a lot: it helps future guests and allows us to improve. It only takes a minute.",
        cta_label: "Laisser un avis",
        cta_label_en: "Leave a review",
        vars: &["bonjour", "prenom", "semaine", "site"],
    },
    SystemTemplate {
        kind: "contract_request",
        label: "Contrat à signer",
        trigger: "Envoyé depuis un dossier (résa manuelle) pour faire signer le contrat en ligne.",
        subject: "Votre contrat de location à signer — {{site}}",
        body: "{{bonjour}}\n\nVotre contrat de location pour la semaine du {{semaine}} à {{site}} est prêt. Merci de le lire et de le signer en ligne — cela ne prend qu'une minute. Ce lien restera ensuite accessible comme copie de votre contrat signé.",
        subject_en: "Your rental contract to sign — {{site}}",
        body_en: "{{bonjour}}\n\nYour rental contract for the week of {{semaine}} at {{site}} is ready. Please read and sign it online — it only takes a minute. This link will then remain available as a copy of your signed contract.",
        cta_label: "Lire et signer le contrat",
        cta_label_en: "Read and sign the contract",
        vars: &["bonjour", "prenom", "semaine", "site"],
    },
];

/// Envoie un e-mail système dans la langue du destinataire : override admin
/// (kind, locale) s'il existe, gabarit par défaut de la langue sinon.
/// `cta_url` vide = pas de bouton.
pub(crate) async fn send_system(
    pool: sqlx::PgPool,
    booking_id: Option<uuid::Uuid>,
    kind: &str,
    to: String,
    vars: &[(&str, String)],
    cta_url: &str,
    lang: Lang,
) -> Result<(), sqlx::Error> {
    let def = SYSTEM_TEMPLATES
        .iter()
        .find(|t| t.kind == kind)
        .expect("e-mail système inconnu");
    let ovr: Option<(String, String)> = sqlx::query_as(
        "select subject, body from email_template_override where kind = $1 and locale = $2",
    )
    .bind(kind)
    .bind(lang.as_str())
    .fetch_optional(&pool)
    .await?;
    let (subject_tpl, body_tpl) = ovr
        .as_ref()
        .map(|(s, b)| (s.as_str(), b.as_str()))
        .unwrap_or((def.subject_for(lang), def.body_for(lang)));
    // {{site}} est injecté automatiquement dans tous les e-mails système.
    let (site, location) = brand(&pool).await;
    let mut all_vars: Vec<(&str, String)> = vars.to_vec();
    all_vars.push(("site", site.clone()));
    let subject = render_template(subject_tpl, &all_vars, false);
    let body = render_email_body(body_tpl, &all_vars);
    // Le titre dans le gabarit visuel reprend le sujet, sans le suffixe marque.
    let heading = subject.trim_end_matches(&format!(" — {site}")).to_string();
    let (label, url) = if cta_url.is_empty() {
        ("", "")
    } else {
        (def.cta_label_for(lang), cta_url)
    };
    let html = template_lang(&site, &location, &heading, &body, label, url, lang);
    spawn(pool, booking_id, kind, to, subject, html);
    Ok(())
}

/// Aplati un fragment HTML riche (Tiptap) en texte brut : les fins de blocs
/// (</p>, <br>, </li>) deviennent des sauts de ligne, les balises sont
/// retirées, les entités usuelles décodées. Pour injecter un champ riche dans
/// un e-mail texte ({{acces}}) sans exposer de balises au destinataire.
pub(crate) fn html_to_text(html: &str) -> String {
    if !html.contains('<') {
        return html.trim().to_string();
    }
    let mut s = inline_anchor_urls(html);
    for tag in [
        "</p>", "</P>", "<br>", "<br/>", "<br />", "</li>", "</LI>", "</h1>", "</h2>", "</h3>",
    ] {
        s = s.replace(tag, "\n");
    }
    // Retire toutes les balises restantes.
    let mut out = String::with_capacity(s.len());
    let mut in_tag = false;
    for c in s.chars() {
        match c {
            '<' => in_tag = true,
            '>' => in_tag = false,
            c if !in_tag => out.push(c),
            _ => {}
        }
    }
    let out = out
        .replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&#39;", "'")
        .replace("&quot;", "\"");
    // Compacte les lignes vides successives et espaces de bord.
    let lines: Vec<&str> = out.lines().map(str::trim).collect();
    let mut cleaned: Vec<&str> = Vec::new();
    for l in lines {
        if l.is_empty() && cleaned.last().is_none_or(|p| p.is_empty()) {
            continue;
        }
        cleaned.push(l);
    }
    cleaned.join("\n").trim().to_string()
}

/// « <a href="U">label</a> » → « label (U)» : sans ça, aplatir un e-mail en
/// texte ferait disparaître l'URL des boutons (confirmation, paiement…).
fn inline_anchor_urls(html: &str) -> String {
    let mut out = String::with_capacity(html.len());
    let mut rest = html;
    loop {
        let Some(start) = rest.find("<a ") else {
            out.push_str(rest);
            return out;
        };
        out.push_str(&rest[..start]);
        let tag_rest = &rest[start..];
        // Balise ouvrante ou fermante introuvable : fragment mal formé, on
        // laisse le strip générique de html_to_text faire le ménage.
        let Some(tag_end) = tag_rest.find('>') else {
            out.push_str(tag_rest);
            return out;
        };
        let Some(close) = tag_rest[tag_end..].find("</a>") else {
            out.push_str(tag_rest);
            return out;
        };
        let href = tag_rest[..tag_end].find("href=\"").and_then(|h| {
            let v = &tag_rest[h + 6..tag_end];
            v.find('"').map(|e| &v[..e])
        });
        let inner = &tag_rest[tag_end + 1..tag_end + close];
        out.push_str(inner);
        if let Some(url) = href {
            if !url.is_empty() && inner.trim() != url {
                out.push_str(" (");
                out.push_str(url);
                out.push(')');
            }
        }
        rest = &tag_rest[tag_end + close + 4..];
    }
}

/// « Bonjour Camille, » / "Hello Camille," — variable {{bonjour}} des gabarits.
pub(crate) fn bonjour_lang(first_name: Option<&str>, lang: Lang) -> String {
    let greeting = match lang {
        Lang::Fr => "Bonjour",
        Lang::En => "Hello",
    };
    match first_name.map(str::trim).filter(|s| !s.is_empty()) {
        Some(n) => format!("{greeting} {n},"),
        None => format!("{greeting},"),
    }
}

/// Variante française historique (campagnes et envois admin, toujours fr).
pub(crate) fn bonjour(first_name: Option<&str>) -> String {
    bonjour_lang(first_name, Lang::Fr)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn html_to_text_conserve_les_urls_des_liens() {
        let html = r#"<p>Votre dossier est prêt.</p><a href="https://ex.fr/pay?t=abc" style="x">Payer l'acompte</a>"#;
        let text = html_to_text(html);
        assert!(
            text.contains("Payer l'acompte (https://ex.fr/pay?t=abc)"),
            "{text}"
        );
    }

    #[test]
    fn html_to_text_lien_dont_le_libelle_est_l_url() {
        let text = html_to_text(r#"<a href="https://ex.fr">https://ex.fr</a>"#);
        assert_eq!(text, "https://ex.fr");
    }

    #[test]
    fn html_to_text_anchor_mal_forme_ne_panique_pas() {
        assert_eq!(
            html_to_text("<a href=\"https://ex.fr\">jamais fermé"),
            "jamais fermé"
        );
        assert_eq!(html_to_text("texte <a "), "texte");
    }

    #[test]
    fn html_to_text_template_complet() {
        let html = template_lang(
            "Site",
            "Les Ménuires",
            "Titre",
            "<p>Corps</p>",
            "Confirmer",
            "https://ex.fr/c",
            Lang::Fr,
        );
        let text = html_to_text(&html);
        assert!(text.contains("Titre"), "{text}");
        assert!(text.contains("Corps"), "{text}");
        assert!(text.contains("Confirmer (https://ex.fr/c)"), "{text}");
        assert!(!text.contains('<'), "{text}");
    }
}
