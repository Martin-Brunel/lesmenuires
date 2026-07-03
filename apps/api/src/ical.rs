//! Import iCal entrant : télécharge les calendriers externes (Airbnb, Booking,
//! Google Agenda…) déclarés en base et bloque les semaines qui chevauchent un
//! évènement occupé. Sens inverse du flux d'export `/api/calendar/:token`.
//!
//! Règles :
//! - seule une semaine `available` peut être bloquée par la synchro ; elle est
//!   alors marquée `blocked_by_feed` pour être débloquée automatiquement quand
//!   l'évènement disparaît du calendrier source ;
//! - un blocage manuel (`blocked_by_feed` null) n'est jamais touché ;
//! - une semaine `booked` qui chevauche un évènement externe = conflit réel
//!   (double réservation entre canaux) : signalé dans `last_error`, jamais modifié ;
//! - un échec de téléchargement/parse ne débloque rien (on garde l'état connu).

use chrono::{Duration, NaiveDate, Utc};
use sqlx::PgPool;
use uuid::Uuid;

/// Intervalle minimal entre deux synchros d'un même flux lors des ticks du
/// scheduler (la synchro manuelle depuis l'admin force toujours).
const MIN_SYNC_INTERVAL_MINUTES: i64 = 30;

/// Taille maximale acceptée pour un fichier .ics téléchargé.
const MAX_ICS_BYTES: usize = 2 * 1024 * 1024;

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FeedSyncOutcome {
    pub feed_id: Uuid,
    pub name: String,
    pub blocked: i64,
    pub unblocked: i64,
    /// Erreur de synchro OU avertissement de conflit (aussi persisté en base).
    pub error: Option<String>,
}

#[derive(sqlx::FromRow)]
struct FeedRow {
    id: Uuid,
    property_id: Uuid,
    name: String,
    url: String,
}

#[derive(sqlx::FromRow)]
struct WeekRow {
    id: Uuid,
    start_date: NaiveDate,
    end_date: NaiveDate,
    range_label: String,
    status: String,
    blocked_by_feed: Option<Uuid>,
}

fn http_client() -> reqwest::Client {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .expect("client reqwest")
}

/// Synchronise tous les flux (tous si `force`, sinon ceux non synchronisés
/// depuis `MIN_SYNC_INTERVAL_MINUTES`). Retourne un résumé par flux traité.
pub async fn sync_all(pool: &PgPool, force: bool) -> Vec<FeedSyncOutcome> {
    let feeds: Vec<FeedRow> = match sqlx::query_as(
        "select id, property_id, name, url from ical_feed \
         where $1 or last_synced_at is null or last_synced_at < now() - ($2 || ' minutes')::interval \
         order by created_at",
    )
    .bind(force)
    .bind(MIN_SYNC_INTERVAL_MINUTES.to_string())
    .fetch_all(pool)
    .await
    {
        Ok(f) => f,
        Err(e) => {
            tracing::error!("ical: lecture des flux impossible: {e:?}");
            return vec![];
        }
    };
    if feeds.is_empty() {
        return vec![];
    }

    let client = http_client();
    let mut outcomes = Vec::with_capacity(feeds.len());
    for feed in feeds {
        let outcome = sync_feed(pool, &client, &feed).await;
        if outcome.blocked + outcome.unblocked > 0 || outcome.error.is_some() {
            tracing::info!(
                "ical «{}»: {} bloquée(s), {} débloquée(s){}",
                outcome.name,
                outcome.blocked,
                outcome.unblocked,
                outcome
                    .error
                    .as_deref()
                    .map(|e| format!(" — {e}"))
                    .unwrap_or_default()
            );
        }
        outcomes.push(outcome);
    }
    outcomes
}

async fn sync_feed(pool: &PgPool, client: &reqwest::Client, feed: &FeedRow) -> FeedSyncOutcome {
    let mut out = FeedSyncOutcome {
        feed_id: feed.id,
        name: feed.name.clone(),
        blocked: 0,
        unblocked: 0,
        error: None,
    };

    let busy = match fetch_busy_ranges(client, &feed.url).await {
        Ok(b) => b,
        Err(e) => {
            out.error = Some(e.clone());
            // Échec réseau/parse : on n'y touche pas, on note l'erreur.
            let _ = sqlx::query(
                "update ical_feed set last_synced_at = now(), last_error = $2 where id = $1",
            )
            .bind(feed.id)
            .bind(&e)
            .execute(pool)
            .await;
            return out;
        }
    };

    match apply_busy_ranges(pool, feed, &busy).await {
        Ok((blocked, unblocked, warning)) => {
            out.blocked = blocked;
            out.unblocked = unblocked;
            out.error = warning;
        }
        Err(e) => out.error = Some(format!("mise à jour des semaines impossible : {e}")),
    }

    let _ =
        sqlx::query("update ical_feed set last_synced_at = now(), last_error = $2 where id = $1")
            .bind(feed.id)
            .bind(out.error.as_deref())
            .execute(pool)
            .await;
    out
}

/// Applique les plages occupées aux semaines de la propriété, dans une
/// transaction. Retourne (bloquées, débloquées, avertissement conflit).
async fn apply_busy_ranges(
    pool: &PgPool,
    feed: &FeedRow,
    busy: &[(NaiveDate, NaiveDate)],
) -> Result<(i64, i64, Option<String>), sqlx::Error> {
    let today = Utc::now().date_naive();
    let mut tx = pool.begin().await?;

    // Semaines à venir de la propriété (le passé ne bouge plus).
    let weeks: Vec<WeekRow> = sqlx::query_as(
        "select id, start_date, end_date, range_label, status, blocked_by_feed \
         from availability_week where property_id = $1 and end_date >= $2 \
         order by start_date for update",
    )
    .bind(feed.property_id)
    .bind(today)
    .fetch_all(&mut *tx)
    .await?;

    let overlaps = |w: &WeekRow| {
        busy.iter()
            .any(|(s, e)| *s < w.end_date && w.start_date < *e)
    };

    let mut blocked = 0i64;
    let mut unblocked = 0i64;
    let mut conflicts: Vec<String> = vec![];

    for w in &weeks {
        let hit = overlaps(w);
        match (w.status.as_str(), w.blocked_by_feed, hit) {
            // Libre et occupée côté externe → on bloque, source tracée.
            ("available", _, true) => {
                sqlx::query(
                    "update availability_week set status = 'blocked', blocked_by_feed = $2 \
                     where id = $1",
                )
                .bind(w.id)
                .bind(feed.id)
                .execute(&mut *tx)
                .await?;
                blocked += 1;
            }
            // Bloquée par CE flux mais plus occupée → on rouvre.
            ("blocked", Some(src), false) if src == feed.id => {
                sqlx::query(
                    "update availability_week set status = 'available', blocked_by_feed = null \
                     where id = $1",
                )
                .bind(w.id)
                .execute(&mut *tx)
                .await?;
                unblocked += 1;
            }
            // Réservée en direct ET occupée côté externe : double réservation
            // inter-canaux — on signale, on ne touche pas.
            ("booked", _, true) => conflicts.push(w.range_label.clone()),
            _ => {}
        }
    }

    tx.commit().await?;

    let warning = (!conflicts.is_empty()).then(|| {
        format!(
            "Conflit : déjà réservé en direct ({}) — vérifiez le canal externe.",
            conflicts.join(", ")
        )
    });
    Ok((blocked, unblocked, warning))
}

/// Télécharge et parse un .ics ; retourne les plages occupées [début, fin)
/// (dates civiles, fin exclusive).
async fn fetch_busy_ranges(
    client: &reqwest::Client,
    url: &str,
) -> Result<Vec<(NaiveDate, NaiveDate)>, String> {
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err("URL invalide (http/https attendu)".into());
    }
    let resp = client
        .get(url)
        .header("User-Agent", "lesmenuires-ical-sync/1.0")
        .send()
        .await
        .map_err(|e| format!("téléchargement impossible : {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("le serveur distant a répondu {}", resp.status()));
    }
    let body = resp
        .text()
        .await
        .map_err(|e| format!("lecture impossible : {e}"))?;
    if body.len() > MAX_ICS_BYTES {
        return Err("fichier .ics trop volumineux".into());
    }
    if !body.contains("BEGIN:VCALENDAR") {
        return Err("le contenu n'est pas un calendrier iCal".into());
    }
    Ok(parse_busy_ranges(&body))
}

/// Parse les VEVENT d'un iCalendar en plages [DTSTART, DTEND) — fin exclusive,
/// sémantique des exports Airbnb/Booking (VALUE=DATE). Les évènements annulés
/// ou transparents (libres) sont ignorés. Tolérant : une ligne illisible est
/// ignorée plutôt que de faire échouer tout le flux.
pub fn parse_busy_ranges(ics: &str) -> Vec<(NaiveDate, NaiveDate)> {
    // Dépliage RFC 5545 : une ligne continuée commence par espace ou tab.
    let unfolded = ics
        .replace("\r\n ", "")
        .replace("\r\n\t", "")
        .replace("\n ", "")
        .replace("\n\t", "");

    let mut ranges = vec![];
    let (mut in_event, mut start, mut end) = (false, None::<NaiveDate>, None::<NaiveDate>);
    let mut skip = false;

    for raw in unfolded.lines() {
        let line = raw.trim_end_matches('\r');
        if line.eq_ignore_ascii_case("BEGIN:VEVENT") {
            (in_event, start, end, skip) = (true, None, None, false);
            continue;
        }
        if line.eq_ignore_ascii_case("END:VEVENT") {
            if in_event && !skip {
                if let Some(s) = start {
                    // DTEND absent = évènement d'un jour (RFC 5545 §3.6.1).
                    let e = end.unwrap_or(s + Duration::days(1));
                    // Évènement horodaté intra-journée : fin exclusive minimale.
                    let e = if e <= s { s + Duration::days(1) } else { e };
                    ranges.push((s, e));
                }
            }
            in_event = false;
            continue;
        }
        if !in_event {
            continue;
        }
        // "NOM;PARAM=…:VALEUR" — le nom s'arrête au premier ';' ou ':'.
        let Some((prop, value)) = line.split_once(':') else {
            continue;
        };
        let name = prop.split(';').next().unwrap_or("").to_ascii_uppercase();
        match name.as_str() {
            "DTSTART" => start = parse_ical_date(value),
            "DTEND" => end = parse_ical_date(value),
            "STATUS" if value.eq_ignore_ascii_case("CANCELLED") => skip = true,
            "TRANSP" if value.eq_ignore_ascii_case("TRANSPARENT") => skip = true,
            _ => {}
        }
    }
    ranges
}

/// "20260711" ou "20260711T120000Z" → date civile (la partie heure est ignorée :
/// on raisonne en nuits d'occupation).
fn parse_ical_date(value: &str) -> Option<NaiveDate> {
    let v = value.trim();
    if v.len() < 8 {
        return None;
    }
    NaiveDate::parse_from_str(&v[..8], "%Y%m%d").ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn d(s: &str) -> NaiveDate {
        NaiveDate::parse_from_str(s, "%Y-%m-%d").unwrap()
    }

    #[test]
    fn parse_airbnb_style() {
        let ics = "BEGIN:VCALENDAR\r\nPRODID:-//Airbnb Inc//EN\r\nVERSION:2.0\r\n\
BEGIN:VEVENT\r\nDTSTAMP:20260701T000000Z\r\nDTSTART;VALUE=DATE:20260711\r\n\
DTEND;VALUE=DATE:20260718\r\nSUMMARY:Reserved\r\nUID:abc@airbnb.com\r\nEND:VEVENT\r\n\
BEGIN:VEVENT\r\nDTSTART;VALUE=DATE:20260801\r\nDTEND;VALUE=DATE:20260808\r\n\
SUMMARY:Airbnb (Not available)\r\nUID:def@airbnb.com\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
        assert_eq!(
            parse_busy_ranges(ics),
            vec![
                (d("2026-07-11"), d("2026-07-18")),
                (d("2026-08-01"), d("2026-08-08")),
            ]
        );
    }

    #[test]
    fn parse_datetime_missing_dtend_cancelled_and_folding() {
        let ics = "BEGIN:VCALENDAR\nBEGIN:VEVENT\nDTSTART:20260711T140000Z\nSUMMARY:Long\n titre plié\nEND:VEVENT\n\
BEGIN:VEVENT\nDTSTART;VALUE=DATE:20260720\nDTEND;VALUE=DATE:20260721\nSTATUS:CANCELLED\nEND:VEVENT\n\
BEGIN:VEVENT\nDTSTART;VALUE=DATE:20260725\nDTEND;VALUE=DATE:20260725\nEND:VEVENT\nEND:VCALENDAR\n";
        assert_eq!(
            parse_busy_ranges(ics),
            vec![
                // DTEND absent → 1 jour ; annulé → ignoré ; DTEND ≤ DTSTART → 1 jour.
                (d("2026-07-11"), d("2026-07-12")),
                (d("2026-07-25"), d("2026-07-26")),
            ]
        );
    }

    #[test]
    fn garbage_is_ignored() {
        assert!(parse_busy_ranges("pas un calendrier").is_empty());
        let ics = "BEGIN:VEVENT\nDTSTART;VALUE=DATE:invalid\nEND:VEVENT\n";
        assert!(parse_busy_ranges(ics).is_empty());
    }
}
