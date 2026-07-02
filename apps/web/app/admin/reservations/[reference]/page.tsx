"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  adminApi,
  fmtEur,
  PAYMENT_FLAG_LABEL,
  type BookingDetail,
  type SignatureInfo,
} from "@/lib/admin-api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Modal } from "@/components/ui/modal";
import { ActionsMenu, type Action } from "@/components/ui/actions-menu";
import { CancelDialog } from "@/components/admin/CancelDialog";
import { useConfirm, usePrompt } from "@/components/admin/dialogs";
import { toast } from "@/components/ui/toast";

const STATUS_LABEL: Record<string, string> = {
  cart: "Panier",
  confirmed: "Confirmée",
  balance_paid: "Soldée",
  cancelled: "Annulée",
  expired: "Expirée",
};
const STATUS_VARIANT: Record<string, "success" | "warning" | "muted" | "destructive"> = {
  cart: "warning",
  confirmed: "success",
  balance_paid: "success",
  cancelled: "destructive",
  expired: "muted",
};

const EMAIL_KIND: Record<string, string> = {
  welcome: "Confirmation de réservation",
  magic_link: "Lien de connexion",
  balance_paid: "Solde réglé",
  balance_prenotify: "Prélèvement du solde à venir",
  payment_issue: "Incident de paiement",
  cart_reminder: "Relance panier",
  cancellation: "Annulation",
};
const EMAIL_STATUS: Record<string, { label: string; variant: "success" | "warning" | "muted" | "destructive" }> = {
  sent: { label: "Envoyé", variant: "muted" },
  delivered: { label: "Délivré", variant: "success" },
  opened: { label: "Ouvert", variant: "success" },
  bounced: { label: "Rejeté", variant: "destructive" },
  complained: { label: "Spam", variant: "destructive" },
  failed: { label: "Échec", variant: "destructive" },
};
const PAYMENT_KIND: Record<string, string> = {
  deposit: "Acompte",
  balance: "Solde",
  caution_capture: "Débit caution (dégâts)",
  caution_release: "Clôture caution",
  refund: "Remboursement",
};

const dt = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" }) : "—";
const d = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" }) : "—";

export default function ReservationDetailPage() {
  const params = useParams<{ reference: string }>();
  const reference = params.reference;
  const [data, setData] = useState<BookingDetail | null>(null);
  const [error, setError] = useState(false);
  const [pending, setPending] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [sig, setSig] = useState<SignatureInfo | null | "loading">(null);
  const confirm = useConfirm();
  const prompt = usePrompt();

  const reload = useCallback(() => {
    adminApi
      .bookingDetail(reference)
      .then((r) => {
        setData(r);
        setError(false);
      })
      .catch(() => setError(true));
  }, [reference]);
  useEffect(() => reload(), [reload]);

  if (error) return <p className="text-sm text-destructive">Dossier introuvable ou erreur de chargement.</p>;
  if (!data) return <p className="text-sm text-muted-foreground">Chargement…</p>;

  const b = data.booking;
  const active = b.status !== "cancelled";
  const parseEuros = (s: string | null): number | null => {
    if (s === null) return null;
    const n = Math.round(parseFloat(s.replace(",", ".")) * 100);
    if (!Number.isFinite(n) || n <= 0) {
      toast.error("Montant invalide.");
      return null;
    }
    return n;
  };
  const run = async (fn: () => Promise<void>) => {
    setPending(true);
    try {
      await fn();
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    } finally {
      setPending(false);
    }
  };

  const markPaid = async (kind: "deposit" | "balance") => {
    const method = await prompt({
      title: kind === "deposit" ? "Pointer l'acompte" : "Pointer le solde",
      description: "Moyen de règlement reçu.",
      label: "Méthode — cheque ou virement",
      defaultValue: b.paymentMethod ?? "cheque",
    });
    if (method === null) return;
    const m = method.trim().toLowerCase();
    if (m !== "cheque" && m !== "virement") return toast.error("Méthode invalide (cheque ou virement).");
    run(async () => {
      await adminApi.markPaid(reference, kind, m as "cheque" | "virement");
      toast.success("Échéance pointée.");
    });
  };
  const captureCaution = async () => {
    const max = (b.cautionCents / 100).toFixed(0);
    const amount = parseEuros(
      await prompt({ title: "Débiter des dégâts", description: `Max ${max} €.`, label: "Montant (€)", defaultValue: max }),
    );
    if (amount === null) return;
    if (amount > b.cautionCents) return toast.error(`Le montant dépasse la caution (max ${max} €).`);
    run(async () => {
      await adminApi.captureCaution(reference, amount);
      toast.success(`${fmtEur(amount)} débités sur la caution.`);
    });
  };
  const releaseCaution = async () => {
    if (!(await confirm({ title: "Clôturer la caution sans débit ?", description: "Aucun dégât : rien n'est débité.", confirmLabel: "Clôturer" }))) return;
    run(async () => {
      await adminApi.releaseCaution(reference);
      toast.success("Caution clôturée.");
    });
  };
  const refund = async () => {
    const type = await prompt({ title: "Rembourser", description: "Quel paiement ?", label: "deposit (acompte) ou balance (solde)", defaultValue: "deposit" });
    if (type === null) return;
    const t = type.trim().toLowerCase();
    if (t !== "deposit" && t !== "balance") return toast.error("Type invalide.");
    const maxCents = t === "balance" ? b.balanceCents : b.depositCents;
    const amount = parseEuros(await prompt({ title: "Montant à rembourser", label: "Montant (€)", defaultValue: (maxCents / 100).toFixed(0) }));
    if (amount === null) return;
    run(async () => {
      await adminApi.refundPayment(reference, amount, t);
      toast.success(`${fmtEur(amount)} remboursés.`);
    });
  };
  const viewSignature = async () => {
    setSig("loading");
    try {
      setSig(await adminApi.getSignature(reference));
    } catch {
      setSig({ signaturePng: null, contractVersion: null, signedAt: null });
    }
  };

  const actions: Action[] = [];
  if (b.channel === "manual" && !b.depositPaidAt && active)
    actions.push({ label: "Pointer l'acompte", onClick: () => markPaid("deposit"), disabled: pending });
  if (b.channel === "manual" && b.depositPaidAt && !b.balancePaidAt && active)
    actions.push({ label: "Pointer le solde", onClick: () => markPaid("balance"), disabled: pending });
  if ((b.status === "confirmed" || b.status === "balance_paid") && b.cautionCents > 0 && !b.cautionReleasedAt) {
    actions.push({ label: "Débiter des dégâts", onClick: captureCaution, disabled: pending });
    actions.push({ label: "Clôturer la caution", onClick: releaseCaution, disabled: pending });
  }
  if (b.depositPaidAt && active) actions.push({ label: "Rembourser", onClick: refund, disabled: pending });
  if (active && b.status !== "cart")
    actions.push({ label: "Annuler la réservation", onClick: () => setCancelOpen(true), danger: true });

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link href="/admin/reservations" className="text-sm text-primary underline underline-offset-2">
            ‹ Réservations
          </Link>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Dossier {b.reference}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Badge variant={STATUS_VARIANT[b.status] ?? "muted"}>{STATUS_LABEL[b.status] ?? b.status}</Badge>
            {b.channel === "manual" && (
              <Badge variant="secondary">Manuel{b.paymentMethod ? ` · ${b.paymentMethod}` : ""}</Badge>
            )}
            {b.paymentFlag && (
              <Badge variant="destructive">{PAYMENT_FLAG_LABEL[b.paymentFlag] ?? b.paymentFlag}</Badge>
            )}
          </div>
        </div>
        <ActionsMenu actions={actions} label="Actions du dossier" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Récapitulatif */}
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Récapitulatif</CardTitle></CardHeader>
          <CardContent className="space-y-1.5 text-sm">
            <Row label="Séjour" value={`${b.weekRange} · arrivée ${b.arrival || d(b.startDate)}`} />
            <Row label="Voyageurs" value={`${b.adults} adulte(s)${b.children ? ` · ${b.children} enfant(s)` : ""}`} />
            <Row label="Total séjour" value={fmtEur(b.totalCents)} />
            <Row label={`Acompte (${b.depositPct} %)`} value={fmtEur(b.depositCents)} />
            <Row label="Solde" value={fmtEur(b.balanceCents)} />
            {b.touristTaxCents > 0 && <Row label="dont taxe de séjour" value={fmtEur(b.touristTaxCents)} muted />}
            <Row label="Caution" value={`${fmtEur(b.cautionCents)}${b.cautionMethod === "cheque" ? " · chèque" : " · carte"}`} />
            <Row label="Créé le" value={dt(b.createdAt)} muted />
            {b.adminNotes && <Row label="Notes" value={b.adminNotes} />}
          </CardContent>
        </Card>

        {/* Client & accès */}
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Client & accès</CardTitle></CardHeader>
          <CardContent className="space-y-1.5 text-sm">
            <Row label="Nom" value={b.customerName ?? "—"} />
            <Row label="E-mail" value={b.customerEmail ?? "—"} />
            <Row label="Téléphone" value={b.customerPhone || "—"} />
            <Row label="Adresse" value={b.customerAddress || "—"} />
            <div className="pt-2 text-xs text-muted-foreground">
              <div className="font-medium text-foreground">Consignes d&apos;arrivée</div>
              <p className="mt-1 whitespace-pre-line">{b.arrivalInstructions || "—"}</p>
            </div>
          </CardContent>
        </Card>

        {/* Contrat */}
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Contrat</CardTitle></CardHeader>
          <CardContent className="space-y-1.5 text-sm">
            {b.contractSignedAt ? (
              <>
                <Row label="Signé le" value={dt(b.contractSignedAt)} />
                <Row label="Version" value={b.contractVersion ?? "—"} />
                {b.hasSignature && (
                  <Button size="sm" variant="secondary" className="mt-2" onClick={viewSignature}>
                    Voir la signature
                  </Button>
                )}
              </>
            ) : (
              <p className="text-muted-foreground">Contrat non signé.</p>
            )}
          </CardContent>
        </Card>

        {/* Règlement */}
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Règlement</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Milestone label="Acompte" amount={b.depositCents} paidAt={b.depositPaidAt} />
            <Milestone label="Solde" amount={b.balanceCents} paidAt={b.balancePaidAt} />
            <div className="flex items-center justify-between border-t pt-2">
              <span className="text-muted-foreground">Caution</span>
              <span>
                {b.cautionReleasedAt
                  ? b.cautionCapturedCents && b.cautionCapturedCents > 0
                    ? `${fmtEur(b.cautionCapturedCents)} débités`
                    : "Clôturée"
                  : `${fmtEur(b.cautionCents)} · en garantie`}
              </span>
            </div>
            {(b.balanceAttempts > 0 || b.cautionAttempts > 0) && active && (
              <p className="text-xs text-destructive" title={b.balanceLastError ?? b.cautionLastError ?? ""}>
                ⚠ Échec de prélèvement
                {b.balanceAttempts > 0 ? ` solde ×${b.balanceAttempts}` : ""}
                {b.cautionAttempts > 0 ? ` caution ×${b.cautionAttempts}` : ""}
              </p>
            )}
            {data.payments.length > 0 && (
              <div className="mt-2 space-y-1 border-t pt-2 text-xs text-muted-foreground">
                {data.payments.map((p, i) => (
                  <div key={i} className="flex items-center justify-between">
                    <span>
                      {PAYMENT_KIND[p.kind] ?? p.kind}
                      {p.method ? ` · ${p.method}` : p.provider === "stripe" ? " · carte" : ""} — {dt(p.createdAt)}
                    </span>
                    <span>{fmtEur(p.amountCents)}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Suivi des e-mails */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Suivi des e-mails</CardTitle></CardHeader>
        <CardContent>
          {data.emails.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucun e-mail envoyé pour ce dossier.</p>
          ) : (
            <ul className="divide-y">
              {data.emails.map((e, i) => {
                const st = EMAIL_STATUS[e.status] ?? { label: e.status, variant: "muted" as const };
                return (
                  <li key={i} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <div>
                      <div className="font-medium">{EMAIL_KIND[e.kind] ?? e.kind}</div>
                      <div className="text-xs text-muted-foreground">
                        {dt(e.sentAt ?? e.createdAt)} → {e.recipient}
                        {e.openedAt ? ` · ouvert le ${dt(e.openedAt)}` : ""}
                        {e.error ? ` · ${e.error}` : ""}
                      </div>
                    </div>
                    <Badge variant={st.variant}>{st.label}</Badge>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {cancelOpen && (
        <CancelDialog
          booking={b}
          onClose={() => setCancelOpen(false)}
          onDone={() => {
            setCancelOpen(false);
            reload();
          }}
        />
      )}
      {sig !== null && (
        <Modal open onClose={() => setSig(null)} title={`Signature — ${b.reference}`}>
          {sig === "loading" ? (
            <p className="text-sm text-muted-foreground">Chargement…</p>
          ) : sig.signaturePng ? (
            <img src={sig.signaturePng} alt="Signature" className="w-full rounded-md border bg-white" />
          ) : (
            <p className="text-sm text-muted-foreground">Aucune signature enregistrée.</p>
          )}
        </Modal>
      )}
    </div>
  );
}

function Row({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className={muted ? "text-muted-foreground" : "text-right font-medium"}>{value}</span>
    </div>
  );
}

function Milestone({ label, amount, paidAt }: { label: string; amount: number; paidAt: string | null }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="flex items-center gap-2">
        <span className="font-medium">{fmtEur(amount)}</span>
        {paidAt ? (
          <Badge variant="success">Réglé</Badge>
        ) : (
          <Badge variant="warning">En attente</Badge>
        )}
      </span>
    </div>
  );
}
