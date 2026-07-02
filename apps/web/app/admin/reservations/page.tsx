"use client";

import { useEffect, useState } from "react";
import { adminApi, fmtEur, PAYMENT_FLAG_LABEL, type AdminBooking, type AdminWeek, type SignatureInfo } from "@/lib/admin-api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { ActionsMenu, type Action } from "@/components/ui/actions-menu";
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
  expired: "Expirée",
};

const STATUS_VARIANT: Record<
  string,
  "default" | "secondary" | "success" | "warning" | "muted" | "destructive"
> = {
  cart: "warning",
  confirmed: "success",
  balance_paid: "success",
  cancelled: "destructive",
  expired: "muted",
};

export default function ReservationsPage() {
  const [bookings, setBookings] = useState<AdminBooking[] | null>(null);
  const [cancelTarget, setCancelTarget] = useState<AdminBooking | null>(null);
  const [sigTarget, setSigTarget] = useState<{ ref: string; info: SignatureInfo | null }>();
  const [pending, setPending] = useState<string | null>(null);
  const [showManual, setShowManual] = useState(false);
  const confirm = useConfirm();
  const prompt = usePrompt();

  const viewSignature = async (ref: string) => {
    setSigTarget({ ref, info: null });
    try {
      setSigTarget({ ref, info: await adminApi.getSignature(ref) });
    } catch {
      setSigTarget({ ref, info: { signaturePng: null, contractVersion: null, signedAt: null } });
    }
  };

  const [loadError, setLoadError] = useState(false);
  const reload = () =>
    adminApi
      .listBookings()
      .then((b) => {
        setBookings(b);
        setLoadError(false);
      })
      .catch(() => setLoadError(true));
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
      title: "Clôturer la caution sans débit ?",
      description: "Aucun dégât : la caution est clôturée, rien n'est débité au client.",
      confirmLabel: "Clôturer",
    });
    if (!ok) return;
    setPending(reference);
    try {
      await adminApi.releaseCaution(reference);
      toast.success("Caution clôturée.");
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    } finally {
      setPending(null);
    }
  };

  const captureCaution = async (b: AdminBooking) => {
    const max = (b.cautionCents / 100).toFixed(0);
    const amount = parseEuros(
      await prompt({
        title: "Débiter des dégâts",
        description: `Montant à débiter sur la carte enregistrée du client (max ${max} €).`,
        label: "Montant (€)",
        defaultValue: max,
        confirmLabel: "Débiter",
      }),
    );
    if (amount === null) return;
    if (amount > b.cautionCents) {
      toast.error(`Le montant dépasse la caution (max ${max} €).`);
      return;
    }
    setPending(b.reference);
    try {
      await adminApi.captureCaution(b.reference, amount);
      toast.success(`${fmtEur(amount)} débités sur la caution.`);
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    } finally {
      setPending(null);
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
    const maxCents = t === "balance" ? b.balanceCents : b.depositCents;
    const amount = parseEuros(
      await prompt({
        title: "Montant à rembourser",
        label: "Montant (€)",
        defaultValue: (maxCents / 100).toFixed(0),
        confirmLabel: "Rembourser",
      }),
    );
    if (amount === null) return;
    setPending(b.reference);
    try {
      await adminApi.refundPayment(b.reference, amount, t);
      toast.success(`${fmtEur(amount)} remboursés.`);
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    } finally {
      setPending(null);
    }
  };

  const markPaid = async (b: AdminBooking, kind: "deposit" | "balance") => {
    const method = await prompt({
      title: kind === "deposit" ? "Pointer l'acompte" : "Pointer le solde",
      description: "Moyen de règlement reçu.",
      label: "Méthode — cheque ou virement",
      defaultValue: b.paymentMethod ?? "cheque",
      confirmLabel: "Pointer",
    });
    if (method === null) return;
    const m = method.trim().toLowerCase();
    if (m !== "cheque" && m !== "virement") {
      toast.error("Méthode invalide (cheque ou virement).");
      return;
    }
    setPending(b.reference);
    try {
      await adminApi.markPaid(b.reference, kind, m);
      toast.success(kind === "deposit" ? "Acompte pointé." : "Solde pointé.");
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    } finally {
      setPending(null);
    }
  };

  const rowActions = (b: AdminBooking): Action[] => {
    const acts: Action[] = [];
    const busy = pending === b.reference;
    const active = b.status !== "cancelled";
    if (b.channel === "manual" && !b.depositPaidAt && active)
      acts.push({ label: "Pointer l'acompte", onClick: () => markPaid(b, "deposit"), disabled: busy });
    if (b.channel === "manual" && b.depositPaidAt && !b.balancePaidAt && active)
      acts.push({ label: "Pointer le solde", onClick: () => markPaid(b, "balance"), disabled: busy });
    if ((b.status === "confirmed" || b.status === "balance_paid") && b.cautionCents > 0 && !b.cautionReleasedAt) {
      acts.push({ label: "Débiter des dégâts", onClick: () => captureCaution(b), disabled: busy });
      acts.push({ label: "Clôturer la caution", onClick: () => releaseCaution(b.reference), disabled: busy });
    }
    if (b.depositPaidAt && active)
      acts.push({ label: "Rembourser", onClick: () => refund(b), disabled: busy });
    if (b.contractSignedAt)
      acts.push({ label: "Voir la signature", onClick: () => viewSignature(b.reference) });
    if (active && b.status !== "cart")
      acts.push({ label: "Annuler la réservation", onClick: () => setCancelTarget(b), danger: true });
    return acts;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Réservations</h1>
          <p className="text-sm text-muted-foreground">
            Réservations reçues, les plus récentes en premier.
          </p>
        </div>
        <Button onClick={() => setShowManual(true)}>Nouvelle réservation</Button>
      </div>
      <Card className="overflow-hidden">
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
            {loadError && (
              <TableRow>
                <TableCell colSpan={8} className="text-destructive py-6 text-center">
                  Impossible de charger les réservations. Rechargez la page.
                </TableCell>
              </TableRow>
            )}
            {!loadError && bookings === null && (
              <TableRow>
                <TableCell colSpan={8} className="text-muted-foreground py-6 text-center">
                  Chargement…
                </TableCell>
              </TableRow>
            )}
            {!loadError && bookings?.length === 0 && (
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
                    {b.channel === "manual" && (
                      <Badge variant="secondary" title={`Réservation manuelle · ${b.paymentMethod ?? ""}`}>
                        Manuel{b.paymentMethod ? ` · ${b.paymentMethod}` : ""}
                      </Badge>
                    )}
                    {b.balanceOverdue && (
                      <Badge variant="destructive" title="Solde impayé alors que l'arrivée est passée">
                        Solde en retard
                      </Badge>
                    )}
                    {b.paymentFlag && (
                      <Badge
                        variant="destructive"
                        title="Événement Stripe hors-app : prélèvements automatiques suspendus"
                      >
                        {PAYMENT_FLAG_LABEL[b.paymentFlag] ?? b.paymentFlag}
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
                    {b.contractSignedAt && (
                      <span
                        className="text-xs text-muted-foreground"
                        title={`Contrat signé le ${new Date(b.contractSignedAt).toLocaleString("fr-FR")}`}
                      >
                        ✓ Contrat signé
                      </span>
                    )}
                    {b.cautionReleasedAt && (
                      <span className="text-xs text-muted-foreground">
                        {b.cautionCapturedCents && b.cautionCapturedCents > 0
                          ? `Caution : ${fmtEur(b.cautionCapturedCents)} débités`
                          : "Caution clôturée"}
                      </span>
                    )}
                  </div>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                  {new Date(b.createdAt).toLocaleDateString("fr-FR")}
                </TableCell>
                <TableCell className="text-right">
                  <ActionsMenu actions={rowActions(b)} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      {showManual && (
        <ManualBookingDialog
          onClose={() => setShowManual(false)}
          onDone={() => {
            setShowManual(false);
            reload();
          }}
        />
      )}
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
      {sigTarget && (
        <Modal
          open
          onClose={() => setSigTarget(undefined)}
          title={`Signature — ${sigTarget.ref}`}
        >
          {!sigTarget.info ? (
            <p className="text-sm text-muted-foreground">Chargement…</p>
          ) : sigTarget.info.signaturePng ? (
            <div className="space-y-3">
              <img
                src={sigTarget.info.signaturePng}
                alt="Signature du contrat"
                className="w-full rounded-md border bg-white"
              />
              <p className="text-xs text-muted-foreground">
                Contrat v{sigTarget.info.contractVersion ?? "—"}
                {sigTarget.info.signedAt
                  ? ` · signé le ${new Date(sigTarget.info.signedAt).toLocaleString("fr-FR")}`
                  : ""}
              </p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Aucune signature enregistrée.</p>
          )}
        </Modal>
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

function ManualBookingDialog({
  onClose,
  onDone,
}: {
  onClose: () => void;
  onDone: () => void;
}) {
  const [weeks, setWeeks] = useState<AdminWeek[] | null>(null);
  const [weekId, setWeekId] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [addressLine, setAddressLine] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [city, setCity] = useState("");
  const [adults, setAdults] = useState(2);
  const [children, setChildren] = useState(0);
  const [paymentMethod, setPaymentMethod] = useState<"cheque" | "virement">("cheque");
  const [cautionMethod, setCautionMethod] = useState<"cheque" | "card">("cheque");
  const [depositPaid, setDepositPaid] = useState(false);
  const [balancePaid, setBalancePaid] = useState(false);
  const [adminNotes, setAdminNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    adminApi
      .listWeeks("ladret")
      .then((w) => setWeeks(w.filter((x) => x.status === "available")))
      .catch(() => setWeeks([]));
  }, []);

  const valid = weekId && /.+@.+\..+/.test(email) && firstName.trim() && lastName.trim();

  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      await adminApi.createManualBooking({
        weekId,
        customer: { firstName, lastName, email, phone, addressLine, postalCode, city },
        adults,
        children,
        paymentMethod,
        cautionMethod,
        depositPaid,
        balancePaid,
        adminNotes,
      });
      toast.success("Réservation manuelle créée.");
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur");
    } finally {
      setBusy(false);
    }
  };

  const field = "w-full rounded-md border bg-background px-3 py-2 text-sm";

  return (
    <Modal open onClose={onClose} title="Nouvelle réservation manuelle">
      <div className="space-y-3">
        <div>
          <label className="text-xs text-muted-foreground">Semaine</label>
          <select className={field} value={weekId} onChange={(e) => setWeekId(e.target.value)}>
            <option value="">— Choisir une semaine disponible —</option>
            {(weeks ?? []).map((w) => (
              <option key={w.id} value={w.id}>
                {w.rangeLabel} · {fmtEur(w.priceCents)}
              </option>
            ))}
          </select>
          {weeks && weeks.length === 0 && (
            <p className="mt-1 text-xs text-muted-foreground">Aucune semaine disponible.</p>
          )}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Input placeholder="Prénom" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
          <Input placeholder="Nom" value={lastName} onChange={(e) => setLastName(e.target.value)} />
        </div>
        <Input placeholder="E-mail" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <div className="grid grid-cols-2 gap-2">
          <Input placeholder="Téléphone" value={phone} onChange={(e) => setPhone(e.target.value)} />
          <Input placeholder="Adresse" value={addressLine} onChange={(e) => setAddressLine(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Input placeholder="Code postal" value={postalCode} onChange={(e) => setPostalCode(e.target.value)} />
          <Input placeholder="Ville" value={city} onChange={(e) => setCity(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-xs text-muted-foreground">Adultes</label>
            <Input type="number" min={1} value={adults} onChange={(e) => setAdults(Number(e.target.value))} />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Enfants</label>
            <Input type="number" min={0} value={children} onChange={(e) => setChildren(Number(e.target.value))} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-xs text-muted-foreground">Règlement</label>
            <select className={field} value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value as "cheque" | "virement")}>
              <option value="cheque">Chèque</option>
              <option value="virement">Virement</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Caution</label>
            <select className={field} value={cautionMethod} onChange={(e) => setCautionMethod(e.target.value as "cheque" | "card")}>
              <option value="cheque">Chèque de caution</option>
              <option value="card">Carte</option>
            </select>
          </div>
        </div>
        <div className="flex gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={depositPaid} onChange={(e) => setDepositPaid(e.target.checked)} />
            Acompte déjà reçu
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={balancePaid} onChange={(e) => setBalancePaid(e.target.checked)} />
            Solde déjà reçu
          </label>
        </div>
        <textarea
          className={field}
          placeholder="Notes internes (facultatif)"
          rows={2}
          value={adminNotes}
          onChange={(e) => setAdminNotes(e.target.value)}
        />
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Annuler
          </Button>
          <Button onClick={submit} disabled={!valid || busy}>
            {busy ? "…" : "Créer la réservation"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
