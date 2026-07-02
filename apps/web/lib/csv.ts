// Export CSV « Excel France » : BOM UTF-8 (accents corrects à l'ouverture) et
// séparateur « ; » (celui qu'Excel fr-FR attend par défaut).

type Cell = string | number | null | undefined;

const esc = (v: Cell): string => {
  const s = v == null ? "" : String(v);
  return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function downloadCsv(filename: string, headers: string[], rows: Cell[][]) {
  const body = [headers, ...rows].map((r) => r.map(esc).join(";")).join("\r\n");
  const blob = new Blob(["\ufeff" + body], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Montant en euros pour Excel FR : 119050 -> "1190,50" (nombre, pas de « € »). */
export const csvEur = (cents: number) => (cents / 100).toFixed(2).replace(".", ",");

/** "2026-12-26" (ou ISO datetime) -> "26/12/2026". */
export const csvDate = (iso: string | null | undefined) =>
  iso ? new Date(iso.length === 10 ? iso + "T12:00:00" : iso).toLocaleDateString("fr-FR") : "";
