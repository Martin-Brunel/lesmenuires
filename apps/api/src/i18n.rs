//! Localisation côté API : langue des clients (fr par défaut, en), libellés de
//! dates recalculés à la volée pour le site public et les e-mails, et overlay
//! des contenus traduits stockés en jsonb (`property.translations`,
//! `product.translations` — forme `{"en": {"description": "...", ...}}`).
//!
//! Les libellés français restent la forme canonique stockée en base
//! (availability_week.range_label…) ; l'anglais est dérivé des dates au moment
//! de la lecture, jamais persisté.

use chrono::{Datelike, Duration, NaiveDate};

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Lang {
    Fr,
    En,
}

impl Lang {
    /// Depuis un paramètre `?locale=` ou une colonne `customer.locale`.
    pub fn from_param(v: Option<&str>) -> Lang {
        match v.map(str::trim) {
            Some("en") => Lang::En,
            _ => Lang::Fr,
        }
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            Lang::Fr => "fr",
            Lang::En => "en",
        }
    }
}

fn month_abbr(m: u32, lang: Lang) -> &'static str {
    match lang {
        Lang::Fr => [
            "jan", "fév", "mars", "avr", "mai", "juin", "juil", "août", "sept", "oct", "nov", "déc",
        ][(m - 1) as usize],
        Lang::En => [
            "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
        ][(m - 1) as usize],
    }
}

fn month_full(m: u32, lang: Lang) -> &'static str {
    match lang {
        Lang::Fr => [
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
        ][(m - 1) as usize],
        Lang::En => [
            "January",
            "February",
            "March",
            "April",
            "May",
            "June",
            "July",
            "August",
            "September",
            "October",
            "November",
            "December",
        ][(m - 1) as usize],
    }
}

/// « 26 déc 2026 — 02 jan 2027 » / "26 Dec 2026 — 02 Jan 2027".
/// L'année figure toujours (une saison de ski chevauche deux années civiles).
pub fn range_label(start: NaiveDate, end: NaiveDate, lang: Lang) -> String {
    if start.year() != end.year() {
        format!(
            "{:02} {} {} — {:02} {} {}",
            start.day(),
            month_abbr(start.month(), lang),
            start.year(),
            end.day(),
            month_abbr(end.month(), lang),
            end.year()
        )
    } else if start.month() == end.month() {
        format!(
            "{:02} — {:02} {} {}",
            start.day(),
            end.day(),
            month_abbr(end.month(), lang),
            end.year()
        )
    } else {
        format!(
            "{:02} {} — {:02} {} {}",
            start.day(),
            month_abbr(start.month(), lang),
            end.day(),
            month_abbr(end.month(), lang),
            end.year()
        )
    }
}

/// « samedi 19 décembre 2026 » / "Saturday 19 December 2026".
pub fn arrival_full(d: NaiveDate, lang: Lang) -> String {
    match lang {
        Lang::Fr => format!(
            "samedi {} {} {}",
            d.day(),
            month_full(d.month(), lang),
            d.year()
        ),
        Lang::En => format!(
            "Saturday {} {} {}",
            d.day(),
            month_full(d.month(), lang),
            d.year()
        ),
    }
}

/// « sam. 19 déc 2026 » / "Sat 19 Dec 2026".
pub fn short_label(d: NaiveDate, lang: Lang) -> String {
    match lang {
        Lang::Fr => format!(
            "sam. {} {} {}",
            d.day(),
            month_abbr(d.month(), lang),
            d.year()
        ),
        Lang::En => format!(
            "Sat {} {} {}",
            d.day(),
            month_abbr(d.month(), lang),
            d.year()
        ),
    }
}

/// Date du prélèvement du solde (arrivée − 14 j), en toutes lettres.
pub fn balance_due_label(start: NaiveDate, lang: Lang) -> String {
    let b = start - Duration::days(14);
    format!("{} {} {}", b.day(), month_full(b.month(), lang), b.year())
}

/// Montant en euros pour les e-mails : « 1234,56 € » / "€1,234.56" (sans
/// séparateur de milliers côté fr, comme l'historique scheduler::eur).
pub fn eur(cents: i64, lang: Lang) -> String {
    match lang {
        Lang::Fr => format!("{},{:02} €", cents / 100, (cents % 100).abs()),
        Lang::En => format!("€{}.{:02}", cents / 100, (cents % 100).abs()),
    }
}

/// Valeur traduite d'un champ : `translations[lang][key]` si non vide, sinon le
/// texte français canonique.
pub fn tr_field(translations: &serde_json::Value, lang: Lang, key: &str, fallback: &str) -> String {
    if lang == Lang::Fr {
        return fallback.to_string();
    }
    translations
        .get(lang.as_str())
        .and_then(|t| t.get(key))
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(String::from)
        .unwrap_or_else(|| fallback.to_string())
}

/// Libellé d'un palier tarifaire dans la langue demandée : `labelEn` du palier
/// (season.rate_tiers) si présent, sinon le libellé français `fallback`.
pub fn tier_label(
    rate_tiers: &serde_json::Value,
    tier_key: Option<&str>,
    lang: Lang,
    fallback: &str,
) -> String {
    if lang == Lang::Fr {
        return fallback.to_string();
    }
    let Some(key) = tier_key else {
        return fallback.to_string();
    };
    rate_tiers
        .as_array()
        .and_then(|arr| {
            arr.iter()
                .find(|t| t.get("key").and_then(|k| k.as_str()) == Some(key))
        })
        .and_then(|t| t.get("labelEn"))
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(String::from)
        .unwrap_or_else(|| fallback.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn d(s: &str) -> NaiveDate {
        NaiveDate::parse_from_str(s, "%Y-%m-%d").unwrap()
    }

    #[test]
    fn range_labels_both_langs() {
        assert_eq!(
            range_label(d("2026-12-26"), d("2027-01-02"), Lang::Fr),
            "26 déc 2026 — 02 jan 2027"
        );
        assert_eq!(
            range_label(d("2026-12-26"), d("2027-01-02"), Lang::En),
            "26 Dec 2026 — 02 Jan 2027"
        );
        assert_eq!(
            range_label(d("2027-02-06"), d("2027-02-13"), Lang::En),
            "06 — 13 Feb 2027"
        );
        assert_eq!(
            range_label(d("2027-01-30"), d("2027-02-06"), Lang::En),
            "30 Jan — 06 Feb 2027"
        );
    }

    #[test]
    fn arrival_and_balance_en() {
        assert_eq!(
            arrival_full(d("2026-12-19"), Lang::En),
            "Saturday 19 December 2026"
        );
        assert_eq!(short_label(d("2026-12-19"), Lang::En), "Sat 19 Dec 2026");
        assert_eq!(
            balance_due_label(d("2026-12-19"), Lang::En),
            "5 December 2026"
        );
        assert_eq!(
            balance_due_label(d("2026-12-19"), Lang::Fr),
            "5 décembre 2026"
        );
    }

    #[test]
    fn tr_field_overlay() {
        let tr: serde_json::Value =
            serde_json::json!({ "en": { "description": "Hello", "empty": "  " } });
        assert_eq!(tr_field(&tr, Lang::En, "description", "Bonjour"), "Hello");
        assert_eq!(tr_field(&tr, Lang::En, "empty", "Bonjour"), "Bonjour");
        assert_eq!(tr_field(&tr, Lang::En, "missing", "Bonjour"), "Bonjour");
        assert_eq!(tr_field(&tr, Lang::Fr, "description", "Bonjour"), "Bonjour");
    }

    #[test]
    fn tier_label_en() {
        let tiers = serde_json::json!([
            { "key": "vac", "label": "Vacances scolaires", "labelEn": "School holidays" },
            { "key": "std", "label": "Semaine standard" }
        ]);
        assert_eq!(
            tier_label(&tiers, Some("vac"), Lang::En, "Vacances scolaires"),
            "School holidays"
        );
        assert_eq!(
            tier_label(&tiers, Some("std"), Lang::En, "Semaine standard"),
            "Semaine standard"
        );
        assert_eq!(tier_label(&tiers, None, Lang::En, "fallback"), "fallback");
        assert_eq!(
            tier_label(&tiers, Some("vac"), Lang::Fr, "Vacances scolaires"),
            "Vacances scolaires"
        );
    }
}
