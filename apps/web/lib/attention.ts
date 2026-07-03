// « Actions requises » : raisons pour lesquelles un dossier attend une action
// de l'admin. Partagé entre le tableau de bord et la fiche réservation pour ne
// jamais diverger (même logique, mêmes libellés).

import { PAYMENT_FLAG_LABEL } from "./admin-api";

/** Local-midnight date from an ISO "YYYY-MM-DD" (avoids UTC shifting the day). */
const localDate = (iso: string) => new Date(`${iso}T00:00:00`);

export function daysFromToday(iso: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((localDate(iso).getTime() - today.getTime()) / 86_400_000);
}

/** Champs nécessaires au diagnostic — AdminBooking les a tous ; la fiche
 *  (BookingDetailInfo) fournit endDate/balanceOverdue calculés côté page. */
export type AttentionInput = {
  status: string;
  paymentFlag: string | null;
  balanceOverdue: boolean;
  balanceAttempts: number;
  cautionAttempts: number;
  cautionCents: number;
  endDate: string;
  cautionReleasedAt: string | null;
  cautionCapturedCents: number | null;
  cautionMethod: string | null;
  paymentMethod: string | null;
};

/** Reasons a booking needs the operator's attention. */
export function attentionReasons(b: AttentionInput): string[] {
  const out: string[] = [];
  if (b.status === "pending_payment") {
    out.push(
      b.paymentMethod === "cheque"
        ? "Acompte (chèque) à encaisser — confirme la réservation"
        : "Acompte (virement) à recevoir — confirme la réservation",
    );
  }
  if (b.paymentFlag) out.push(PAYMENT_FLAG_LABEL[b.paymentFlag] ?? b.paymentFlag);
  if (b.balanceOverdue) out.push("Solde en retard");
  if (b.balanceAttempts > 0 && b.status !== "cancelled")
    out.push(`Échec prélèvement solde ×${b.balanceAttempts}`);
  if (b.cautionAttempts > 0 && b.status !== "cancelled")
    out.push(`Échec caution ×${b.cautionAttempts}`);
  // Stay is over but the caution was neither released nor charged: the guest is
  // waiting for their guarantee to be closed (card) or their cheque back.
  if (
    (b.status === "confirmed" || b.status === "balance_paid") &&
    b.cautionCents > 0 &&
    daysFromToday(b.endDate) <= 0 &&
    !b.cautionReleasedAt &&
    b.cautionCapturedCents == null
  ) {
    out.push(b.cautionMethod === "cheque" ? "Chèque de caution à rendre" : "Caution à clôturer");
  }
  return out;
}
