"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { adminApi, fmtEur, PAYMENT_FLAG_LABEL, type AdminBooking, type AdminWeek, type SignatureInfo } from "@/lib/admin-api";
import { csvDate, csvEur, downloadCsv } from "@/lib/csv";
import { todayIso } from "@/lib/dates";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { ActionsMenu, type Action } from "@/components/ui/actions-menu";
import { CancelDialog } from "@/components/admin/CancelDialog";
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

const PAGE_SIZE = 20;

export default function ReservationsPage() {
  const [bookings, setBookings] = useState<AdminBooking[] | null>(null);
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [page, setPage] = useState(0);
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
    const stayStarted = new Date(b.startDate + "T00:00:00") <= new Date();
    const refundable =
      Math.max(0, (b.depositPaidAt ? b.depositCents : 0) - b.depositRefundedCents) +
      Math.max(0, (b.balancePaidAt ? b.balanceCents : 0) - b.balanceRefundedCents);
    if (b.channel === "manual" && !b.depositPaidAt && active)
      acts.push({ label: "Pointer l'acompte", onClick: () => markPaid(b, "deposit"), disabled: busy });
    if (b.channel === "manual" && b.depositPaidAt && !b.balancePaidAt && active)
      acts.push({ label: "Pointer le solde", onClick: () => markPaid(b, "balance"), disabled: busy });
    if (
      (b.status === "confirmed" || b.status === "balance_paid") &&
      b.cautionCents > 0 &&
      !b.cautionReleasedAt &&
      stayStarted
    ) {
      acts.push({ label: "Débiter des dégâts", onClick: () => captureCaution(b), disabled: busy });
      acts.push({ label: "Clôturer la caution", onClick: () => releaseCaution(b.reference), disabled: busy });
    }
    if (refundable > 0)
      acts.push({ label: "Rembourser", onClick: () => refund(b), disabled: busy });
    if (b.contractSignedAt)
      acts.push({ label: "Voir la signature", onClick: () => viewSignature(b.reference) });
    if (active && b.status !== "cart")
      acts.push({ label: "Annuler la réservation", onClick: () => setCancelTarget(b), danger: true });
    return acts;
  };

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (bookings ?? []).filter((b) => {
      if (statusFilter === "active") {
        if (b.status !== "confirmed" && b.status !== "balance_paid") return false;
      } else if (statusFilter !== "all" && b.status !== statusFilter) return false;
      if (!needle) return true;
      return (
        b.reference.toLowerCase().includes(needle) ||
        (b.customerName ?? "").toLowerCase().includes(needle) ||
        (b.customerEmail ?? "").toLowerCase().includes(needle) ||
        b.weekRange.toLowerCase().includes(needle)
      );
    });
  }, [bookings, q, statusFilter]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = filtered.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Réservations</h1>
          <p className="text-sm text-muted-foreground">
            Réservations reçues, les plus récentes en premier.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            disabled={filtered.length === 0}
            onClick={() =>
              downloadCsv(
                "reservations.csv",
                ["Référence", "Statut", "Canal", "Semaine", "Arrivée", "Départ", "Client", "E-mail", "Téléphone", "Adultes", "Enfants", "Total (€)", "Acompte (€)", "Solde (€)", "Acompte payé le", "Solde payé le", "Créée le"],
                filtered.map((b) => [
                  b.reference,
                  STATUS_LABEL[b.status] ?? b.status,
                  b.channel === "manual" ? "Manuel" : "Site",
                  b.weekRange,
                  csvDate(b.startDate),
                  csvDate(b.endDate),
                  b.customerName ?? "",
                  b.customerEmail ?? "",
                  b.customerPhone ?? "",
                  b.adults,
                  b.children,
                  csvEur(b.totalCents),
                  csvEur(b.depositCents),
                  csvEur(b.balanceCents),
                  csvDate(b.depositPaidAt),
                  csvDate(b.balancePaidAt),
                  csvDate(b.createdAt),
                ]),
              )
            }
          >
            Exporter CSV
          </Button>
          <Button onClick={() => setShowManual(true)}>Nouvelle réservation</Button>
        </div>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <Input
          placeholder="Rechercher (référence, nom, e-mail, semaine)…"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(0);
          }}
          className="max-w-xs"
        />
        <select
          aria-label="Filtrer par statut"
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value);
            setPage(0);
          }}
          className="h-9 rounded-md border bg-background px-3 text-sm"
        >
          <option value="all">Tous les statuts</option>
          <option value="active">Actives (confirmées + soldées)</option>
          {Object.entries(STATUS_LABEL).map(([v, label]) => (
            <option key={v} value={v}>{label}</option>
          ))}
        </select>
        {(q || statusFilter !== "all") && (
          <span className="text-sm text-muted-foreground">
            {filtered.length} résultat(s)
          </span>
        )}
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
            {!loadError && bookings !== null && filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="text-muted-foreground py-6 text-center">
                  {bookings.length === 0
                    ? "Aucune réservation pour le moment."
                    : "Aucune réservation ne correspond à la recherche."}
                </TableCell>
              </TableRow>
            )}
            {pageRows.map((b) => (
              <TableRow key={b.reference} className={b.status === "cancelled" ? "opacity-60" : undefined}>
                <TableCell className="font-mono text-xs">
                  <Link
                    href={`/admin/reservations/${b.reference}`}
                    className="text-primary underline underline-offset-2 hover:text-foreground"
                  >
                    {b.reference}
                  </Link>
                </TableCell>
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
        {pageCount > 1 && (
          <div className="flex items-center justify-between gap-3 border-t p-3 text-sm">
            <span className="text-muted-foreground">
              Page {safePage + 1} / {pageCount} — {filtered.length} réservation(s)
            </span>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="secondary"
                disabled={safePage === 0}
                onClick={() => setPage(safePage - 1)}
              >
                ‹ Précédent
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={safePage >= pageCount - 1}
                onClick={() => setPage(safePage + 1)}
              >
                Suivant ›
              </Button>
            </div>
          </div>
        )}
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
  // Une réservation hors ligne n'a pas de carte enregistrée : la caution est
  // toujours un chèque de caution (une caution « carte » serait impossible à débiter).
  const cautionMethod = "cheque" as const;
  const [depositPaid, setDepositPaid] = useState(false);
  const [balancePaid, setBalancePaid] = useState(false);
  const [adminNotes, setAdminNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Seules les semaines encore disponibles de la saison active ont un sens
    // pour une réservation manuelle (pas les saisons passées ni écoulées).
    const today = todayIso();
    adminApi
      .listSeasons("ladret")
      .then((ss) => {
        const active = ss.find((s) => s.isActive) ?? ss[0];
        return adminApi.listWeeks("ladret", active?.id);
      })
      .then((w) =>
        setWeeks(w.filter((x) => x.status === "available" && x.startDate >= today)),
      )
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
            <div className={`${field} flex items-center text-muted-foreground`}>Chèque de caution</div>
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
