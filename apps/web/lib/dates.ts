// French date formatting for the admin (native <input type="date"> shows the
// browser locale, so we echo the value in French to remove all ambiguity).

/** "2026-12-19" -> "samedi 19 décembre 2026" */
export function frLong(iso: string) {
  if (!iso) return "";
  const d = new Date(iso + "T12:00:00");
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/** "2026-12-19" -> "19 déc. 2026" */
export function frShort(iso: string) {
  if (!iso) return "";
  const d = new Date(iso + "T12:00:00");
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** Today as an ISO date string (YYYY-MM-DD), local time. */
export function todayIso() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}
