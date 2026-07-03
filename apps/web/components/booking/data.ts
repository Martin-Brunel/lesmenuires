// Theme tokens + pricing helpers for the booking funnel.
// Domain data (property, weeks, products) now comes from the API — see lib/api.ts.

import type { ApiProduct, ApiWeek } from "@/lib/api";

/** Accent color of the retained direction (« Premium éditorial »). */
export const ACCENT = "#4E6E8C";

export type ExtrasState = Record<string, boolean>;

// Formatage des montants et des dates : voir lib/i18n (money, monthYear,
// balanceDueDate) — localisé fr/en, partagé serveur/client.

/** "2026-02-21" -> "2026-02" */
export const monthKey = (isoDate: string) => isoDate.slice(0, 7);

/** Ordered unique month keys present in the weeks. */
export function monthsOf(weeks: { startDate: string }[]) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const w of weeks) {
    const k = monthKey(w.startDate);
    if (!seen.has(k)) {
      seen.add(k);
      out.push(k);
    }
  }
  return out;
}

/** No product pre-selected: extras are strictly opt-in. */
export function defaultExtras(products: ApiProduct[]): ExtrasState {
  const state: ExtrasState = {};
  for (const p of products) state[p.key] = false;
  return state;
}

/** Default to the first available (non-booked) week of the season. */
export function pickDefaultWeek(weeks: ApiWeek[]): number {
  const i = weeks.findIndex((w) => !w.booked);
  return i === -1 ? 0 : i;
}

/** Nights in a strict Saturday→Saturday week (mirrors pricing::NIGHTS_PER_WEEK). */
export const NIGHTS_PER_WEEK = 7;

export function computeTotals(
  weekPriceCents: number,
  products: ApiProduct[],
  extras: ExtrasState,
  depositPct: number,
  touristTaxCentsPerAdultNight = 0,
  adults = 0,
  taxIncluded = false,
) {
  const extrasTotal = products.reduce(
    (acc, p) => acc + (extras[p.key] ? p.priceCents : 0),
    0,
  );
  const rental = weekPriceCents + extrasTotal;
  // Taxe de séjour : par adulte et par nuit (mineurs exonérés). Mirrors
  // pricing::compute côté serveur (incluse dans le total ou ajoutée au solde).
  const touristTax =
    Math.max(0, touristTaxCentsPerAdultNight) * Math.max(0, adults) * NIGHTS_PER_WEEK;
  const total = taxIncluded ? rental + touristTax : rental;
  const deposit = Math.round((total * depositPct) / 100);
  const balance = taxIncluded ? total - deposit : rental - deposit + touristTax;
  return { extrasTotal, total, deposit, balance, touristTax };
}
