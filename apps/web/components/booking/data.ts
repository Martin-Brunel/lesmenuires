// Theme tokens + pricing helpers for the booking funnel.
// Domain data (property, weeks, products) now comes from the API — see lib/api.ts.

import type { ApiProduct, ApiWeek } from "@/lib/api";

/** Accent color of the retained direction (« Premium éditorial »). */
export const ACCENT = "#4E6E8C";

export type ExtrasState = Record<string, boolean>;

/** Format a euro amount from cents the French way: 119000 -> "1 190 €". */
export const eur = (cents: number) =>
  (cents / 100).toLocaleString("fr-FR") + " €";

const FR_MONTHS = [
  "janvier", "février", "mars", "avril", "mai", "juin",
  "juillet", "août", "septembre", "octobre", "novembre", "décembre",
];

/** "2026-02-21" -> "2026-02" */
export const monthKey = (isoDate: string) => isoDate.slice(0, 7);

/** "2026-02" or "2026-02-21" -> "Février 2026" */
export function frMonthYear(isoDate: string) {
  const year = isoDate.slice(0, 4);
  const m = Number(isoDate.slice(5, 7));
  const name = FR_MONTHS[m - 1] ?? "";
  return name.charAt(0).toUpperCase() + name.slice(1) + " " + year;
}

/** Date the balance is charged: arrival minus `daysBefore` days, in French
 *  ("5 décembre 2026"). Computed live so it's correct for every week. */
export function balanceDueLabel(startDate: string, daysBefore = 14): string {
  const d = new Date(startDate + "T12:00:00");
  d.setDate(d.getDate() - daysBefore);
  return `${d.getDate()} ${FR_MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

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

/** "draps" pre-selected, like the prototype; other products off by default. */
export function defaultExtras(products: ApiProduct[]): ExtrasState {
  const state: ExtrasState = {};
  for (const p of products) state[p.key] = p.key === "draps";
  return state;
}

/** Default to the first available (non-booked) week of the season. */
export function pickDefaultWeek(weeks: ApiWeek[]): number {
  const i = weeks.findIndex((w) => !w.booked);
  return i === -1 ? 0 : i;
}

export function computeTotals(
  weekPriceCents: number,
  products: ApiProduct[],
  extras: ExtrasState,
  depositPct: number,
) {
  const extrasTotal = products.reduce(
    (acc, p) => acc + (extras[p.key] ? p.priceCents : 0),
    0,
  );
  const total = weekPriceCents + extrasTotal;
  const deposit = Math.round((total * depositPct) / 100);
  const balance = total - deposit;
  return { extrasTotal, total, deposit, balance };
}
