"use client";

import { useEffect, useState } from "react";
import { adminApi, fmtEur, type AdminBooking } from "@/lib/admin-api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useConfirm, usePrompt } from "@/components/admin/dialogs";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

const STATUS_LABEL: Record<string, string> = {
  cart: "Panier",
  confirmed: "Confirmée",
  balance_paid: "Soldée",
  cancelled: "Annulée",
};

const STATUS_VARIANT: Record<
  string,
  "default" | "secondary" | "success" | "warning" | "muted" | "destructive"
> = {
  cart: "warning",
  confirmed: "success",
  balance_paid: "success",
  cancelled: "destructive",
};

export default function ReservationsPage() {
  const [bookings, setBookings] = useState<AdminBooking[] | null>(null);
  const [cancelTarget, setCancelTarget] = useState<AdminBooking | null>(null);
  const confirm = useConfirm();
  const prompt = usePrompt();

  const reload = () => adminApi.listBookings().then(setBookings).catch(() => setBookings([]));
  useEffect(() => {
    reload();
  }, []);

  const parseEuros = (input: string | null): number | null => {
    if (input === null) return null;
    const amount = Math.round(parseFloat(input.replace(",", ".")) * 100);
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error("Montant invalide.");
      return null;
    }
    return amount;
  };

  const releaseCaution = async (reference: string) => {
    const ok = await confirm({
      title: "Libérer la caution ?",
      description: "L'empreinte est annulée, aucun montant n'est débité au client.",
      confirmLabel: "Libérer",
    });
    if (!ok) return;
    try {
      await adminApi.releaseCaution(reference);
      toast.success("Caution libérée.");
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    }
  };

  const captureCaution = async (b: AdminBooking) => {
    const max = (b.cautionCents / 100).toFixed(0);
    const amount = parseEuros(
      await prompt({
        title: "Capturer la caution",
        description: `Montant à débiter sur l'empreinte (max ${max} €).`,
        label: "Montant (€)",
        defaultValue: max,
        confirmLabel: "Capturer",
      }),
    );
    if (amount === null) return;
    if (amount > b.cautionCents) {
      toast.error(`Le montant dépasse la caution (max ${max} €).`);
      return;
    }
    try {
      await adminApi.captureCaution(b.reference, amount);
      toast.success(`${(amount / 100).toFixed(2)} € capturés sur la caution.`);
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    }
  };

  const refund = async (b: AdminBooking) => {
    const type = await prompt({
      title: "Rembourser un paiement",
      description: "Quel paiement souhaitez-vous rembourser ?",
      label: "Type — deposit (acompte) ou balance (solde)",
      defaultValue: "deposit",
      confirmLabel: "Continuer",
    });
    if (type === null) return;
    const t = type.trim().toLowerCase();
    if (t !== "deposit" && t !== "balance") {
      toast.error("Type invalide (deposit ou balance).");
      return;
    }
    const amount = parseEuros(
      await prompt({
        title: "Montant à rembourser",
        label: "Montant (€)",
        defaultValue: (b.depositCents / 100).toFixed(0),
        confirmLabel: "Rembourser",
      }),
    );
    if (amount === null) return;
    try {
      await adminApi.refundPayment(b.reference, amount, t);
      toast.success(`${(amount / 100).toFixed(2)} € remboursés.`);
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Réservations</h1>
        <p className="text-sm text-muted-foreground">
          Réservations reçues, les plus récentes en premier.
        </p>
      </div>
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Référence</TableHead>
              <TableHead>Client</TableHead>
              <TableHead>Semaine</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead className="text-right">Acompte</TableHead>
              <TableHead>Statut</TableHead>
              <TableHead>Date</TableHead>
              <TableHead className="text-right" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {bookings === null && (
              <TableRow>
                <TableCell colSpan={8} className="text-muted-foreground py-6 text-center">
                  Chargement…
                </TableCell>
              </TableRow>
            )}
            {bookings?.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="text-muted-foreground py-6 text-center">
                  Aucune réservation pour le moment.
                </TableCell>
              </TableRow>
            )}
            {bookings?.map((b) => (
              <TableRow key={b.reference} className={b.status === "cancelled" ? "opacity-60" : undefined}>
                <TableCell className="font-mono text-xs">{b.reference}</TableCell>
                <TableCell>
                  <div className="text-sm">{b.customerName ?? "—"}</div>
                  <div className="text-xs text-muted-foreground">{b.customerEmail ?? ""}</div>
                </TableCell>
                <TableCell className="whitespace-nowrap">{b.weekRange}</TableCell>
                <TableCell className="text-right font-medium">{fmtEur(b.totalCents)}</TableCell>
                <TableCell className="text-right">{fmtEur(b.depositCents)}</TableCell>
                <TableCell>
                  <div className="flex flex-col items-start gap-1">
                    <Badge variant={STATUS_VARIANT[b.status] ?? "muted"}>
                      {STATUS_LABEL[b.status] ?? b.status}
                    </Badge>
                    {b.balanceOverdue && (
                      <Badge variant="destructive" title="Solde impayé alors que l'arrivée est passée">
                        Solde en retard
                      </Badge>
                    )}
                    {(b.balanceAttempts > 0 || b.cautionAttempts > 0) &&
                      b.status !== "cancelled" && (
                        <span
                          className="text-xs text-destructive"
                          title={b.balanceLastError ?? b.cautionLastError ?? ""}
                        >
                          ⚠ Échec prélèvement
                          {b.balanceAttempts > 0 ? ` solde ×${b.balanceAttempts}` : ""}
                          {b.cautionAttempts > 0 ? ` caution ×${b.cautionAttempts}` : ""}
                        </span>
                      )}
                  </div>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                  {new Date(b.createdAt).toLocaleDateString("fr-FR")}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-1">
                    {b.cautionAuthorizedAt && !b.cautionReleasedAt && (
                      <>
                        <Button size="sm" variant="ghost" onClick={() => releaseCaution(b.reference)}>
                          Libérer caution
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => captureCaution(b)}>
                          Capturer
                        </Button>
                      </>
                    )}
                    {b.cautionReleasedAt && (
                      <span className="text-xs text-muted-foreground">
                        {b.cautionCapturedCents && b.cautionCapturedCents > 0
                          ? `Caution : ${fmtEur(b.cautionCapturedCents)} capturés`
                          : "Caution libérée"}
                      </span>
                    )}
                    {b.depositPaidAt && b.status !== "cancelled" && (
                      <Button size="sm" variant="ghost" onClick={() => refund(b)}>
                        Rembourser
                      </Button>
                    )}
                    {b.status !== "cancelled" && b.status !== "cart" && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive hover:text-destructive"
                        onClick={() => setCancelTarget(b)}
                      >
                        Annuler
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      {cancelTarget && (
        <CancelDialog
          booking={cancelTarget}
          onClose={() => setCancelTarget(null)}
          onDone={() => {
            setCancelTarget(null);
            reload();
          }}
        />
      )}
    </div>
  );
}

function CancelDialog({
  booking,
  onClose,
  onDone,
}: {
  booking: AdminBooking;
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
        La semaine redevient disponible et l&apos;empreinte de caution éventuelle est libérée.
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
                className={cn(
                  "w-24",
                  error && "border-destructive focus-visible:ring-destructive",
                )}
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
