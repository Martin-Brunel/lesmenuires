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
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
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
  arrival_reminder: "Rappel avant arrivée",
  automation: "E-mail automatique",
  cancellation: "Annulation",
  manual: "E-mail manuel",
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
const dd = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" }) : "—";
const todayIso = () => new Date().toISOString().slice(0, 10);

type Ev = { at: string; title: string; detail?: string; tone: "default" | "success" | "danger" | "muted" };

export default function ReservationDetailPage() {
  const params = useParams<{ reference: string }>();
  const reference = params.reference;
  const [data, setData] = useState<BookingDetail | null>(null);
  const [error, setError] = useState(false);
  const [pending, setPending] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);
  const [markKind, setMarkKind] = useState<"deposit" | "balance" | null>(null);
  const [sig, setSig] = useState<SignatureInfo | null | "loading">(null);
  const [note, setNote] = useState("");
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
  // Damages assessed at check-out: no caution action before the stay begins.
  const stayStarted = new Date(b.startDate + "T00:00:00") <= new Date();
  // Refundable amount still owed (works even after cancellation).
  const refundable =
    Math.max(0, (b.depositPaidAt ? b.depositCents : 0) - b.depositRefundedCents) +
    Math.max(0, (b.balancePaidAt ? b.balanceCents : 0) - b.balanceRefundedCents);
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
  const clearFlag = async () => {
    if (!(await confirm({ title: "Lever le blocage ?", description: "À utiliser une fois le litige / remboursement résolu. Le dossier redevient opérable (prélèvement, paiement client).", confirmLabel: "Lever le blocage" }))) return;
    run(async () => {
      await adminApi.clearFlag(reference);
      toast.success("Blocage levé.");
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
  const addNote = async () => {
    const body = note.trim();
    if (!body) return;
    run(async () => {
      await adminApi.addNote(reference, body);
      setNote("");
      toast.success("Note ajoutée.");
    });
  };

  // Visible actions bar (also usable when the row is manual / caution active…).
  const actionBtns: { label: string; onClick: () => void; danger?: boolean }[] = [];
  if (b.channel === "manual" && !b.depositPaidAt && active)
    actionBtns.push({ label: "Pointer l'acompte", onClick: () => setMarkKind("deposit") });
  if (b.channel === "manual" && b.depositPaidAt && !b.balancePaidAt && active)
    actionBtns.push({ label: "Pointer le solde", onClick: () => setMarkKind("balance") });
  if (
    (b.status === "confirmed" || b.status === "balance_paid") &&
    b.cautionCents > 0 &&
    !b.cautionReleasedAt &&
    stayStarted
  ) {
    actionBtns.push({ label: "Débiter des dégâts", onClick: captureCaution });
    actionBtns.push({ label: "Clôturer la caution", onClick: releaseCaution });
  }
  // Refund stays available after cancellation as long as something remains refundable.
  if (refundable > 0) actionBtns.push({ label: "Rembourser", onClick: refund });
  if (b.paymentFlag)
    actionBtns.push({ label: "Lever le blocage", onClick: clearFlag });
  if (active && b.status !== "cart")
    actionBtns.push({ label: "Annuler la réservation", onClick: () => setCancelOpen(true), danger: true });

  // CRM event timeline (derived from booking lifecycle + payments + emails + notes).
  const events: Ev[] = [];
  events.push({
    at: b.createdAt,
    title: "Dossier créé",
    detail: b.channel === "manual" ? "Réservation manuelle" : "Réservation en ligne",
    tone: "default",
  });
  if (b.contractSignedAt)
    events.push({ at: b.contractSignedAt, title: "Contrat signé", detail: b.contractVersion ? `v${b.contractVersion}` : undefined, tone: "success" });
  data.payments.forEach((p) =>
    events.push({
      at: p.createdAt,
      title: `${PAYMENT_KIND[p.kind] ?? p.kind} — ${fmtEur(p.amountCents)}`,
      detail: p.method ?? (p.provider === "stripe" ? "carte" : p.provider),
      tone: p.kind === "refund" ? "danger" : "success",
    }),
  );
  data.emails.forEach((e) => {
    const name = EMAIL_KIND[e.kind] ?? e.kind;
    events.push({ at: e.createdAt, title: `E-mail envoyé : ${name}`, detail: e.status === "failed" ? "échec" : e.recipient, tone: e.status === "failed" ? "danger" : "muted" });
    if (e.deliveredAt) events.push({ at: e.deliveredAt, title: `E-mail délivré : ${name}`, tone: "muted" });
    if (e.openedAt) events.push({ at: e.openedAt, title: `E-mail ouvert : ${name}`, tone: "success" });
  });
  data.notes.forEach((n) =>
    events.push({ at: n.createdAt, title: "Note interne", detail: n.body + (n.author ? ` — ${n.author}` : ""), tone: "default" }),
  );
  if (b.cancelledAt) events.push({ at: b.cancelledAt, title: "Réservation annulée", tone: "danger" });
  events.sort((x, y) => y.at.localeCompare(x.at));

  const toneDot: Record<Ev["tone"], string> = {
    default: "bg-primary",
    success: "bg-emerald-500",
    danger: "bg-destructive",
    muted: "bg-muted-foreground/40",
  };

  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin/reservations" className="text-sm text-primary underline underline-offset-2">
          ‹ Réservations
        </Link>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">Dossier {b.reference}</h1>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={STATUS_VARIANT[b.status] ?? "muted"}>{STATUS_LABEL[b.status] ?? b.status}</Badge>
            {b.channel === "manual" && (
              <Badge variant="secondary">Manuel{b.paymentMethod ? ` · ${b.paymentMethod}` : ""}</Badge>
            )}
            {b.paymentFlag && <Badge variant="destructive">{PAYMENT_FLAG_LABEL[b.paymentFlag] ?? b.paymentFlag}</Badge>}
          </div>
        </div>
      </div>

      {/* Actions du dossier (visibles) */}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={!b.customerEmail} onClick={() => setEmailOpen(true)}>
          Envoyer un e-mail
        </Button>
        <Link
          href={`/admin/reservations/${b.reference}/facture`}
          className="inline-flex h-8 items-center rounded-md bg-secondary px-3 text-sm font-medium text-secondary-foreground hover:bg-secondary/80"
        >
          Facture / quittance
        </Link>
        {actionBtns.map((a) => (
          <Button
            key={a.label}
            size="sm"
            variant={a.danger ? "ghost" : "secondary"}
            className={a.danger ? "text-destructive hover:text-destructive" : ""}
            disabled={pending}
            onClick={a.onClick}
          >
            {a.label}
          </Button>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Récapitulatif</CardTitle></CardHeader>
          <CardContent className="space-y-1.5 text-sm">
            <Row label="Séjour" value={`${b.weekRange} · arrivée ${b.arrival || dd(b.startDate)}`} />
            <Row label="Voyageurs" value={`${b.adults} adulte(s)${b.children ? ` · ${b.children} enfant(s)` : ""}`} />
            {data.lines
              .filter((l) => l.kind === "product")
              .map((l, i) => (
                <Row
                  key={`${l.label}-${i}`}
                  label={l.quantity > 1 ? `${l.label} ×${l.quantity}` : l.label}
                  value={fmtEur(l.totalCents)}
                  muted
                />
              ))}
            <Row label="Total séjour" value={fmtEur(b.totalCents)} />
            <Row label={`Acompte (${b.depositPct} %)`} value={fmtEur(b.depositCents)} />
            <Row label="Solde" value={fmtEur(b.balanceCents)} />
            {b.touristTaxCents > 0 && <Row label="dont taxe de séjour" value={fmtEur(b.touristTaxCents)} muted />}
            <Row label="Caution" value={`${fmtEur(b.cautionCents)}${b.cautionMethod === "cheque" ? " · chèque" : " · carte"}`} />
            <Row label="Créé le" value={dt(b.createdAt)} muted />
            {b.adminNotes && <Row label="Notes création" value={b.adminNotes} />}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center justify-between">
              Client & accès
              {b.customerId && (
                <Link href={`/admin/contacts/${b.customerId}`} className="text-xs font-normal text-primary underline underline-offset-2">
                  Voir la fiche contact
                </Link>
              )}
            </CardTitle>
          </CardHeader>
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

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Contrat</CardTitle></CardHeader>
          <CardContent className="space-y-1.5 text-sm">
            {b.contractSignedAt ? (
              <>
                <Row label="Signé le" value={dt(b.contractSignedAt)} />
                <Row label="Version" value={b.contractVersion ?? "—"} />
                {b.contractText && (
                  <details className="mt-1">
                    <summary className="cursor-pointer text-xs text-primary underline underline-offset-2">
                      Voir le texte signé
                    </summary>
                    <p className="mt-2 whitespace-pre-line rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
                      {b.contractText}
                    </p>
                  </details>
                )}
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

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Règlement</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Milestone
              label="Acompte"
              amount={b.depositCents}
              paidAt={b.depositPaidAt}
              cancelled={!active}
              onPoint={b.channel === "manual" && !b.depositPaidAt && active ? () => setMarkKind("deposit") : undefined}
            />
            <Milestone
              label="Solde"
              amount={b.balanceCents}
              paidAt={b.balancePaidAt}
              cancelled={!active}
              onPoint={b.channel === "manual" && b.depositPaidAt && !b.balancePaidAt && active ? () => setMarkKind("balance") : undefined}
            />
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
          </CardContent>
        </Card>
      </div>

      {/* Notes internes */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Notes internes</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addNote()}
              placeholder="Ajouter une note (visible en interne uniquement)…"
            />
            <Button size="sm" disabled={pending || !note.trim()} onClick={addNote}>
              Ajouter
            </Button>
          </div>
          {data.notes.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucune note.</p>
          ) : (
            <ul className="space-y-2">
              {data.notes.map((n, i) => (
                <li key={i} className="rounded-md border p-3 text-sm">
                  <p className="whitespace-pre-line">{n.body}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {dt(n.createdAt)}{n.author ? ` · ${n.author}` : ""}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Historique (CRM) */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Historique du dossier</CardTitle></CardHeader>
        <CardContent>
          <ol className="relative space-y-4 border-l pl-5">
            {events.map((e, i) => (
              <li key={i} className="relative">
                <span className={`absolute -left-[23px] top-1.5 size-2.5 rounded-full ring-4 ring-background ${toneDot[e.tone]}`} />
                <div className="text-sm font-medium">{e.title}</div>
                {e.detail && <div className="text-xs text-muted-foreground">{e.detail}</div>}
                <div className="text-xs text-muted-foreground">{dt(e.at)}</div>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>

      {cancelOpen && (
        <CancelDialog booking={b} onClose={() => setCancelOpen(false)} onDone={() => { setCancelOpen(false); reload(); }} />
      )}
      {emailOpen && b.customerEmail && (
        <EmailDialog
          reference={reference}
          to={b.customerEmail}
          onClose={() => setEmailOpen(false)}
          onSent={() => { setEmailOpen(false); reload(); }}
        />
      )}
      {markKind && (
        <MarkPaidDialog
          reference={reference}
          kind={markKind}
          defaultMethod={(b.paymentMethod as "cheque" | "virement") ?? "cheque"}
          onClose={() => setMarkKind(null)}
          onDone={() => { setMarkKind(null); reload(); }}
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

function Milestone({
  label,
  amount,
  paidAt,
  cancelled,
  onPoint,
}: {
  label: string;
  amount: number;
  paidAt: string | null;
  cancelled?: boolean;
  onPoint?: () => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="flex items-center gap-2">
        <span className="font-medium">{fmtEur(amount)}</span>
        {paidAt ? (
          <Badge variant="success">Réglé le {new Date(paidAt).toLocaleDateString("fr-FR")}</Badge>
        ) : cancelled ? (
          <Badge variant="muted">Non dû (annulée)</Badge>
        ) : onPoint ? (
          <Button size="sm" variant="secondary" className="h-6 px-2 text-xs" onClick={onPoint}>
            Pointer
          </Button>
        ) : (
          <Badge variant="warning">En attente</Badge>
        )}
      </span>
    </div>
  );
}

function EmailDialog({
  reference,
  to,
  onClose,
  onSent,
}: {
  reference: string;
  to: string;
  onClose: () => void;
  onSent: () => void;
}) {
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const send = async () => {
    if (!subject.trim() || !message.trim() || busy) return;
    setBusy(true);
    try {
      await adminApi.sendBookingEmail(reference, subject, message);
      toast.success("E-mail envoyé.");
      onSent();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title="Envoyer un e-mail au client"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>Annuler</Button>
          <Button size="sm" onClick={send} disabled={busy || !subject.trim() || !message.trim()}>
            {busy ? "…" : "Envoyer"}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-xs text-muted-foreground">Destinataire : {to}</p>
        <Input placeholder="Sujet" value={subject} onChange={(e) => setSubject(e.target.value)} />
        <textarea
          className="w-full rounded-md border bg-background px-3 py-2 text-sm"
          rows={6}
          placeholder="Votre message…"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">Le message est habillé du modèle L&apos;Adret et journalisé dans le dossier.</p>
      </div>
    </Modal>
  );
}

function MarkPaidDialog({
  reference,
  kind,
  defaultMethod,
  onClose,
  onDone,
}: {
  reference: string;
  kind: "deposit" | "balance";
  defaultMethod: "cheque" | "virement";
  onClose: () => void;
  onDone: () => void;
}) {
  const [method, setMethod] = useState<"cheque" | "virement">(defaultMethod);
  const [date, setDate] = useState(todayIso());
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await adminApi.markPaid(reference, kind, method, date);
      toast.success(kind === "deposit" ? "Acompte pointé." : "Solde pointé.");
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
      setBusy(false);
    }
  };
  const field = "w-full rounded-md border bg-background px-3 py-2 text-sm";
  return (
    <Modal
      open
      onClose={onClose}
      title={kind === "deposit" ? "Pointer l'acompte" : "Pointer le solde"}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>Annuler</Button>
          <Button size="sm" onClick={submit} disabled={busy}>{busy ? "…" : "Enregistrer le règlement"}</Button>
        </>
      }
    >
      <div className="space-y-3">
        <div>
          <label className="text-xs text-muted-foreground">Moyen de règlement</label>
          <select className={field} value={method} onChange={(e) => setMethod(e.target.value as "cheque" | "virement")}>
            <option value="cheque">Chèque</option>
            <option value="virement">Virement</option>
          </select>
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Date de réception</label>
          <input type="date" className={field} value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
      </div>
    </Modal>
  );
}
