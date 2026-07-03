// Cœur i18n du site public. Deux locales : fr (défaut, URLs sans préfixe) et
// en (préfixe /en, retiré par le middleware qui pose l'en-tête x-locale).
// L'admin (/admin) reste français et n'utilise rien de ce module.

import { fr } from "./fr";
import { en } from "./en";

export const LOCALES = ["fr", "en"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "fr";

export type Dict = typeof fr;

const DICTS: Record<Locale, Dict> = { fr, en };

export function isLocale(v: string | null | undefined): v is Locale {
  return v === "fr" || v === "en";
}

export function getDict(locale: Locale): Dict {
  return DICTS[locale] ?? fr;
}

/** Préfixe un chemin interne pour la locale : localePath("en", "/reserver") → "/en/reserver". */
export function localePath(locale: Locale, path: string): string {
  if (locale === DEFAULT_LOCALE) return path;
  if (path === "/") return `/${locale}`;
  return `/${locale}${path}`;
}

/** Le même chemin dans l'autre locale (pour le sélecteur de langue). */
export function switchLocalePath(current: Locale, target: Locale, pathname: string): string {
  // Retire un éventuel préfixe /en pour retrouver le chemin canonique.
  let canonical = pathname;
  for (const l of LOCALES) {
    if (l === DEFAULT_LOCALE) continue;
    if (canonical === `/${l}`) canonical = "/";
    else if (canonical.startsWith(`/${l}/`)) canonical = canonical.slice(l.length + 1);
  }
  void current;
  return localePath(target, canonical);
}

// ---------------------------------------------------------------------------
// Dates & montants localisés (côté client comme côté serveur — Node 22 embarque
// l'ICU complet, le rendu SSR et client est identique).
// ---------------------------------------------------------------------------

const INTL_LOCALE: Record<Locale, string> = { fr: "fr-FR", en: "en-GB" };

/** 119000 → « 1 190 € » (fr) / "€1,190" (en). */
export function money(cents: number, locale: Locale): string {
  const v = (cents / 100).toLocaleString(INTL_LOCALE[locale]);
  return locale === "fr" ? `${v} €` : `€${v}`;
}

/** "2026-02" ou "2026-02-21" → « Février 2026 » / "February 2026". */
export function monthYear(iso: string, locale: Locale): string {
  const d = new Date(iso.slice(0, 7) + "-15T12:00:00");
  if (Number.isNaN(d.getTime())) return "";
  const s = d.toLocaleDateString(INTL_LOCALE[locale], { month: "long", year: "numeric" });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Date de prélèvement du solde : arrivée − daysBefore jours, en toutes lettres. */
export function balanceDueDate(startDate: string, locale: Locale, daysBefore = 14): string {
  const d = new Date(startDate + "T12:00:00");
  if (Number.isNaN(d.getTime())) return "";
  d.setDate(d.getDate() - daysBefore);
  return d.toLocaleDateString(INTL_LOCALE[locale], { day: "numeric", month: "long", year: "numeric" });
}

/** "2026-12-19" → « 19 déc. » / "19 Dec". */
export function shortDate(iso: string | null, locale: Locale): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(INTL_LOCALE[locale], { day: "numeric", month: "short" });
}

/** "2026-08-01T…" → « août 2026 » / "August 2026" (avis). */
export function monthOfDate(iso: string, locale: Locale): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(INTL_LOCALE[locale], { month: "long", year: "numeric" });
}

/** Moyenne d'avis « 4,8 » / "4.8". */
export function ratingAvg(avg: number, locale: Locale): string {
  return avg.toLocaleString(INTL_LOCALE[locale], {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
}
