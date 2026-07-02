"use client";

import { useState } from "react";
import { adminApi, fmtEur } from "@/lib/admin-api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

/** Minimal shape needed to cancel + refund — satisfied by both AdminBooking and
 *  BookingDetailInfo (+ refunded amounts). */
export type CancelableBooking = {
  reference: string;
  depositCents: number;
  balanceCents: number;
  depositPaidAt: string | null;
  balancePaidAt: string | null;
  depositRefundedCents: number;
  balanceRefundedCents: number;
};

/** Rich cancellation dialog with partial/total refund of amounts already paid.
 *  Shared by the reservations list and the reservation detail page. */
export function CancelDialog({
  booking,
  onClose,
  onDone,
}: {
  booking: CancelableBooking;
  onClose: () => void;
  onDone: () => void;
}) {
  const depositPaid = booking.depositPaidAt ? booking.depositCents : 0;
  const balancePaid = booking.balancePaidAt ? booking.balanceCents : 0;
  const depositRefundable = Math.max(0, depositPaid - booking.depositRefundedCents);
  const balanceRefundable = Math.max(0, balancePaid - booking.balanceRefundedCents);

  const [refundDeposit, setRefundDeposit] = useState("0");
  const [refundBalance, setRefundBalance] = useState("0");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const toCents = (s: string) => Math.round((parseFloat(s.replace(",", ".")) || 0) * 100);
  const rd = toCents(refundDeposit);
  const rb = toCents(refundBalance);
  const dError = rd < 0 || rd > depositRefundable;
  const bError = rb < 0 || rb > balanceRefundable;
  const totalRefund = Math.max(0, rd) + Math.max(0, rb);
  const canSubmit = !dError && !bError && !busy;

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    try {
      await adminApi.cancelBooking(booking.reference, {
        reason,
        refundDepositCents: rd,
        refundBalanceCents: rb,
      });
      toast.success(
        totalRefund > 0
          ? `Réservation annulée — ${fmtEur(totalRefund)} remboursés.`
          : "Réservation annulée.",
      );
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`Annuler la réservation ${booking.reference}`}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
            Fermer
          </Button>
          <Button variant="destructive" size="sm" onClick={submit} disabled={!canSubmit}>
            {busy ? "…" : "Confirmer l'annulation"}
          </Button>
        </>
      }
    >
      <div className="rounded-md bg-muted/50 p-3 text-xs leading-relaxed text-muted-foreground">
        <b className="text-foreground">Règle :</b> l&apos;acompte reste acquis et le solde n&apos;est
        pas prélevé. Ajustez ci-dessous pour rembourser, en tout ou partie, les sommes déjà réglées.
        La semaine redevient disponible ; aucune caution n&apos;est prélevée.
      </div>

      <div className="mt-4 space-y-3">
        {depositPaid > 0 ? (
          <RefundField
            label="Acompte"
            paid={depositPaid}
            refunded={booking.depositRefundedCents}
            refundable={depositRefundable}
            value={refundDeposit}
            onChange={setRefundDeposit}
            error={dError}
          />
        ) : (
          <div className="text-sm text-muted-foreground">Acompte non réglé — rien à rembourser.</div>
        )}
        {balancePaid > 0 && (
          <RefundField
            label="Solde"
            paid={balancePaid}
            refunded={booking.balanceRefundedCents}
            refundable={balanceRefundable}
            value={refundBalance}
            onChange={setRefundBalance}
            error={bError}
          />
        )}

        <div>
          <label className="text-xs text-muted-foreground">Motif (optionnel)</label>
          <Input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Ex. demande du client"
          />
        </div>

        <div className="flex justify-between border-t pt-3 text-sm">
          <span className="text-muted-foreground">Total remboursé au client</span>
          <span className={cn("font-semibold", (dError || bError) && "text-destructive")}>
            {fmtEur(totalRefund)}
          </span>
        </div>
      </div>
    </Modal>
  );
}

function RefundField({
  label,
  paid,
  refunded,
  refundable,
  value,
  onChange,
  error,
}: {
  label: string;
  paid: number;
  refunded: number;
  refundable: number;
  value: string;
  onChange: (v: string) => void;
  error: boolean;
}) {
  const fullyRefunded = refundable <= 0;
  return (
    <div className={cn("rounded-md border p-3", error && "border-destructive")}>
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm">
          <div className="font-medium">{label}</div>
          <div className="text-xs text-muted-foreground">
            Réglé : {fmtEur(paid)}
            {refunded > 0 && ` · déjà remboursé : ${fmtEur(refunded)}`}
          </div>
        </div>
        {fullyRefunded ? (
          <span className="text-xs text-muted-foreground">Intégralement remboursé</span>
        ) : (
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="text-xs text-muted-foreground underline hover:text-foreground"
              onClick={() => onChange((refundable / 100).toString())}
            >
              Tout ({fmtEur(refundable)})
            </button>
            <div className="flex items-center gap-1.5">
              <Input
                type="number"
                min={0}
                max={refundable / 100}
                step={10}
                value={value}
                onChange={(e) => onChange(e.target.value)}
                className={cn("w-24", error && "border-destructive focus-visible:ring-destructive")}
              />
              <span className="text-xs text-muted-foreground">€</span>
            </div>
          </div>
        )}
      </div>
      {error && (
        <div className="mt-2 text-xs text-destructive">
          Maximum remboursable : {fmtEur(refundable)}.
        </div>
      )}
    </div>
  );
}
