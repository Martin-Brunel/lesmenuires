"use client";

import { useEffect, useState } from "react";
import {
  adminApi,
  type EmailAutomation,
  type EmailAutomationInput,
  type SystemEmail,
} from "@/lib/admin-api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Modal } from "@/components/ui/modal";
import { toast } from "@/components/ui/toast";
import { useConfirm } from "@/components/admin/dialogs";
import { cn } from "@/lib/utils";

const EVENT_LABEL: Record<string, string> = {
  reservation: "Réservation confirmée",
  arrival: "Arrivée",
  departure: "Départ",
  cancellation: "Annulation",
};

const CHANNEL_LABEL: Record<string, string> = {
  all: "Tous les dossiers",
  online: "Site uniquement",
  manual: "Manuelles uniquement",
};

type EmailStat = { kind: string; sent: number; delivered: number; opened: number; failed: number };

/** Libellés des types du journal (système + divers). */
const KIND_LABEL: Record<string, string> = {
  welcome: "Confirmation de réservation",
  balance_prenotify: "Prélèvement du solde à venir",
  balance_paid: "Solde réglé",
  payment_issue: "Incident de paiement",
  cart_reminder: "Relance panier",
  cancellation: "Annulation",
  contract_request: "Contrat à signer",
  automation: "Transactionnels (tous)",
  arrival_reminder: "Rappel avant arrivée (ancien)",
  magic_link: "Lien de connexion",
  manual: "E-mails manuels",
  admin_invite: "Invitation admin",
  admin_reset: "Réinitialisation mot de passe",
};

const VARIABLES =
  "{{prenom}} {{nom}} {{reference}} {{semaine}} {{arrivee}} {{depart}} {{total}} {{acompte}} {{solde}} {{acces}}";

const selectBase =
  "w-full h-9 rounded-md border border-input bg-background text-foreground px-2 text-sm";

/** "J-7 · Arrivée" / "Jour J · Départ" — planning humain d'une automatisation. */
function timingLabel(a: { event: string; offsetDays: number }): string {
  const ev = EVENT_LABEL[a.event] ?? a.event;
  if (a.offsetDays === 0) return `Jour J · ${ev}`;
  const j = a.offsetDays > 0 ? `J+${a.offsetDays}` : `J${a.offsetDays}`;
  return `${j} · ${ev}`;
}

const EMPTY: EmailAutomationInput = {
  name: "",
  event: "arrival",
  offsetDays: -7,
  channel: "all",
  recipientEmail: "",
  subject: "",
  body: "",
  active: true,
};

export default function EmailsPage() {
  const confirm = useConfirm();
  const [rows, setRows] = useState<EmailAutomation[] | null>(null);
  const [system, setSystem] = useState<SystemEmail[]>([]);
  const [stats, setStats] = useState<EmailStat[]>([]);
  const [error, setError] = useState(false);
  // null = fermé ; "new" = création ; sinon l'automatisation en édition.
  const [editing, setEditing] = useState<EmailAutomation | "new" | null>(null);
  const [editingSystem, setEditingSystem] = useState<SystemEmail | null>(null);

  const reload = () =>
    Promise.all([
      adminApi.listEmailAutomations(),
      adminApi.listSystemEmails(),
      adminApi.emailStats(),
    ])
      .then(([a, s, st]) => {
        setRows(a);
        setSystem(s);
        setStats(st);
      })
      .catch(() => setError(true));
  useEffect(() => {
    reload();
  }, []);

  const resetSystem = async (s: SystemEmail) => {
    if (
      !(await confirm({
        title: "Rétablir le texte par défaut ?",
        description: `« ${s.label} » reprendra le texte d'origine.`,
        confirmLabel: "Rétablir",
      }))
    )
      return;
    try {
      await adminApi.resetSystemEmail(s.kind);
      toast.success("Texte par défaut rétabli.");
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    }
  };

  const toggleActive = async (a: EmailAutomation) => {
    try {
      await adminApi.updateEmailAutomation(a.id, { ...a, active: !a.active });
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    }
  };

  const remove = async (a: EmailAutomation) => {
    if (
      !(await confirm({
        title: "Supprimer ce transactionnel ?",
        description: `« ${a.name} » ne sera plus envoyé. L'historique des envois est conservé sur les dossiers.`,
        danger: true,
        confirmLabel: "Supprimer",
      }))
    )
      return;
    try {
      await adminApi.deleteEmailAutomation(a.id);
      toast.success("Transactionnel supprimé.");
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    }
  };

  if (error)
    return <p className="text-sm text-destructive">Impossible de charger les e-mails.</p>;
  if (rows === null)
    return <p className="text-sm text-muted-foreground">Chargement…</p>;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">E-mails automatiques</h1>
          <p className="text-sm text-muted-foreground">
            Transactionnels rattachés aux événements du séjour (réservation, arrivée, départ,
            annulation), envoyés à J±n. Les e-mails système (paiements, liens de connexion)
            restent gérés automatiquement.
          </p>
        </div>
        <Button onClick={() => setEditing("new")}>Nouveau transactionnel</Button>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Aucun transactionnel. Créez-en un pour automatiser vos communications.
        </p>
      ) : (
        <div className="space-y-2">
          {rows.map((a) => (
            <Card key={a.id} className={cn(!a.active && "opacity-60")}>
              <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{a.name}</span>
                    <Badge variant="secondary">{timingLabel(a)}</Badge>
                    {a.channel !== "all" && (
                      <Badge variant="muted">{CHANNEL_LABEL[a.channel]}</Badge>
                    )}
                    {a.recipientEmail && (
                      <Badge variant="warning">→ {a.recipientEmail}</Badge>
                    )}
                    <Badge variant={a.active ? "success" : "muted"}>
                      {a.active ? "Actif" : "En pause"}
                    </Badge>
                  </div>
                  <div className="mt-1 text-sm text-muted-foreground truncate">
                    « {a.subject} » — {a.sentCount} envoi(s)
                  </div>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button size="sm" variant="secondary" onClick={() => setEditing(a)}>
                    Modifier
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => toggleActive(a)}>
                    {a.active ? "Mettre en pause" : "Activer"}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive hover:text-destructive"
                    onClick={() => remove(a)}
                  >
                    Supprimer
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <div className="space-y-2 pt-2">
        <div>
          <h2 className="text-lg font-semibold">E-mails système</h2>
          <p className="text-sm text-muted-foreground">
            Envoyés automatiquement par la plateforme (paiements, annulations, contrat…).
            Le texte est personnalisable ; « Rétablir » revient au texte d&apos;origine.
          </p>
        </div>
        {system.map((s) => (
          <Card key={s.kind}>
            <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{s.label}</span>
                  {s.customized ? (
                    <Badge variant="warning">Personnalisé</Badge>
                  ) : (
                    <Badge variant="muted">Texte par défaut</Badge>
                  )}
                </div>
                <div className="mt-1 text-sm text-muted-foreground truncate">{s.trigger}</div>
              </div>
              <div className="flex shrink-0 gap-2">
                <Button size="sm" variant="secondary" onClick={() => setEditingSystem(s)}>
                  Personnaliser
                </Button>
                {s.customized && (
                  <Button size="sm" variant="ghost" onClick={() => resetSystem(s)}>
                    Rétablir
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {stats.length > 0 && (
        <div className="space-y-2 pt-2">
          <div>
            <h2 className="text-lg font-semibold">Suivi des envois</h2>
            <p className="text-sm text-muted-foreground">
              90 derniers jours. Délivrance et ouvertures alimentées par le webhook Resend
              (les ouvertures sont sous-estimées : certains clients mail les masquent).
            </p>
          </div>
          <Card className="overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="p-3 font-medium">Type</th>
                  <th className="p-3 text-right font-medium">Envoyés</th>
                  <th className="p-3 text-right font-medium">Délivrés</th>
                  <th className="p-3 text-right font-medium">Ouverts</th>
                  <th className="p-3 text-right font-medium">Échecs</th>
                </tr>
              </thead>
              <tbody>
                {stats.map((s) => (
                  <tr key={s.kind} className="border-b last:border-0">
                    <td className="p-3">{KIND_LABEL[s.kind] ?? s.kind}</td>
                    <td className="p-3 text-right">{s.sent}</td>
                    <td className="p-3 text-right">
                      {s.delivered}
                      {s.sent > 0 && (
                        <span className="ml-1 text-xs text-muted-foreground">
                          ({Math.round((s.delivered / s.sent) * 100)} %)
                        </span>
                      )}
                    </td>
                    <td className="p-3 text-right">
                      {s.opened}
                      {s.delivered > 0 && (
                        <span className="ml-1 text-xs text-muted-foreground">
                          ({Math.round((s.opened / s.delivered) * 100)} %)
                        </span>
                      )}
                    </td>
                    <td className={"p-3 text-right " + (s.failed > 0 ? "text-destructive" : "")}>
                      {s.failed}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>
      )}

      {editing && (
        <AutomationDialog
          initial={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            reload();
          }}
        />
      )}
      {editingSystem && (
        <SystemEmailDialog
          item={editingSystem}
          onClose={() => setEditingSystem(null)}
          onSaved={() => {
            setEditingSystem(null);
            reload();
          }}
        />
      )}
    </div>
  );
}

function SystemEmailDialog({
  item,
  onClose,
  onSaved,
}: {
  item: SystemEmail;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [subject, setSubject] = useState(item.subject ?? item.defaultSubject);
  const [body, setBody] = useState(item.body ?? item.defaultBody);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<{ subject: string; html: string } | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);

  const save = async () => {
    if (busy) return;
    if (!subject.trim() || !body.trim()) {
      toast.error("Sujet et message requis.");
      return;
    }
    setBusy(true);
    try {
      await adminApi.saveSystemEmail(item.kind, subject, body);
      toast.success(`« ${item.label} » personnalisé.`);
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
      setBusy(false);
    }
  };

  const showPreview = async () => {
    if (previewBusy) return;
    setPreviewBusy(true);
    try {
      setPreview(await adminApi.previewEmailAutomation(subject, body));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    } finally {
      setPreviewBusy(false);
    }
  };

  if (preview) {
    return (
      <Modal
        open
        wide
        onClose={() => setPreview(null)}
        title={`Aperçu — ${preview.subject}`}
        description="Rendu réel (gabarit L'Adret) avec des données d'exemple."
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setPreview(null)}>
              Retour à l&apos;édition
            </Button>
            <Button size="sm" onClick={save} disabled={busy}>
              {busy ? "…" : "Enregistrer"}
            </Button>
          </>
        }
      >
        <iframe
          srcDoc={preview.html}
          sandbox=""
          title="Aperçu de l'e-mail"
          className="h-[60vh] w-full rounded-md border bg-white"
        />
      </Modal>
    );
  }

  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={`Personnaliser « ${item.label} »`}
      description={item.trigger}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
            Annuler
          </Button>
          <Button variant="secondary" size="sm" onClick={showPreview} disabled={previewBusy}>
            {previewBusy ? "…" : "Aperçu"}
          </Button>
          <Button size="sm" onClick={save} disabled={busy}>
            {busy ? "…" : "Enregistrer"}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label>Sujet</Label>
          <Input value={subject} onChange={(e) => setSubject(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Message</Label>
          <textarea
            className="w-full rounded-md border bg-background px-3 py-2 text-sm font-mono text-[13px]"
            rows={12}
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Variables : <code className="text-[11px]">{item.vars.map((v) => `{{${v}}}`).join(" ")}</code>
            {item.ctaLabel && (
              <>
                {" "}
                — bouton « {item.ctaLabel} » ajouté automatiquement.
              </>
            )}
            <br />
            HTML autorisé (sanitisé à l&apos;envoi). Sans balise, les retours à la ligne sont
            conservés.
          </p>
        </div>
      </div>
    </Modal>
  );
}

function AutomationDialog({
  initial,
  onClose,
  onSaved,
}: {
  initial: EmailAutomation | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<EmailAutomationInput>(
    initial
      ? {
          name: initial.name,
          event: initial.event,
          offsetDays: initial.offsetDays,
          channel: initial.channel,
          recipientEmail: initial.recipientEmail,
          subject: initial.subject,
          body: initial.body,
          active: initial.active,
        }
      : EMPTY,
  );
  const [busy, setBusy] = useState(false);
  // null = édition ; sinon l'HTML complet renvoyé par l'API (gabarit + exemple).
  const [preview, setPreview] = useState<{ subject: string; html: string } | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const set = (patch: Partial<EmailAutomationInput>) => setForm((f) => ({ ...f, ...patch }));

  // Avant l'événement n'a de sens que pour l'arrivée et le départ.
  const allowBefore = form.event === "arrival" || form.event === "departure";

  const showPreview = async () => {
    if (previewBusy) return;
    if (!form.subject.trim() || !form.body.trim()) {
      toast.error("Renseignez le sujet et le message pour prévisualiser.");
      return;
    }
    setPreviewBusy(true);
    try {
      setPreview(await adminApi.previewEmailAutomation(form.subject, form.body));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    } finally {
      setPreviewBusy(false);
    }
  };

  const save = async () => {
    if (busy) return;
    if (!form.name.trim() || !form.subject.trim() || !form.body.trim()) {
      toast.error("Nom, sujet et message requis.");
      return;
    }
    if (form.recipientEmail !== "" && !form.recipientEmail.trim()) {
      toast.error("Renseignez l'adresse du prestataire.");
      return;
    }
    setBusy(true);
    try {
      if (initial) await adminApi.updateEmailAutomation(initial.id, form);
      else await adminApi.createEmailAutomation(form);
      toast.success(initial ? "Transactionnel mis à jour." : "Transactionnel créé.");
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
      setBusy(false);
    }
  };

  if (preview) {
    return (
      <Modal
        open
        wide
        onClose={() => setPreview(null)}
        title={`Aperçu — ${preview.subject}`}
        description="Rendu réel (gabarit L'Adret) avec des données d'exemple."
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setPreview(null)}>
              Retour à l'édition
            </Button>
            <Button size="sm" onClick={save} disabled={busy}>
              {busy ? "…" : "Enregistrer"}
            </Button>
          </>
        }
      >
        <iframe
          srcDoc={preview.html}
          sandbox=""
          title="Aperçu de l'e-mail"
          className="h-[60vh] w-full rounded-md border bg-white"
        />
      </Modal>
    );
  }

  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={initial ? `Modifier « ${initial.name} »` : "Nouveau transactionnel"}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
            Annuler
          </Button>
          <Button variant="secondary" size="sm" onClick={showPreview} disabled={previewBusy}>
            {previewBusy ? "…" : "Aperçu"}
          </Button>
          <Button size="sm" onClick={save} disabled={busy}>
            {busy ? "…" : "Enregistrer"}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label>Nom interne</Label>
          <Input
            placeholder="Ex. Rappel avant arrivée"
            value={form.name}
            onChange={(e) => set({ name: e.target.value })}
          />
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div className="space-y-1.5">
            <Label>Événement</Label>
            <select
              value={form.event}
              onChange={(e) => {
                const event = e.target.value;
                const before = event === "arrival" || event === "departure";
                set({
                  event,
                  offsetDays: !before && form.offsetDays < 0 ? 0 : form.offsetDays,
                });
              }}
              className={selectBase}
            >
              {Object.entries(EVENT_LABEL).map(([v, label]) => (
                <option key={v} value={v}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label>Décalage (jours)</Label>
            <Input
              type="number"
              min={allowBefore ? -60 : 0}
              max={365}
              value={String(form.offsetDays)}
              onChange={(e) => set({ offsetDays: parseInt(e.target.value || "0", 10) })}
            />
            <p className="text-xs text-muted-foreground">
              {form.offsetDays === 0
                ? "Le jour de l'événement"
                : form.offsetDays < 0
                  ? `${-form.offsetDays} jour(s) avant`
                  : `${form.offsetDays} jour(s) après`}
            </p>
          </div>
          <div className="space-y-1.5">
            <Label>Dossiers concernés</Label>
            <select
              value={form.channel}
              onChange={(e) => set({ channel: e.target.value })}
              className={selectBase}
            >
              {Object.entries(CHANNEL_LABEL).map(([v, label]) => (
                <option key={v} value={v}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label>Destinataire</Label>
            <select
              value={form.recipientEmail === "" ? "client" : "custom"}
              onChange={(e) =>
                set({ recipientEmail: e.target.value === "client" ? "" : form.recipientEmail || " " })
              }
              className={selectBase}
            >
              <option value="client">Client du dossier</option>
              <option value="custom">Adresse fixe (prestataire…)</option>
            </select>
          </div>
        </div>
        {form.recipientEmail !== "" && (
          <div className="space-y-1.5">
            <Label>Adresse(s) du prestataire</Label>
            <Input
              placeholder="menage@exemple.fr, linge@exemple.fr"
              value={form.recipientEmail.trimStart()}
              onChange={(e) => set({ recipientEmail: e.target.value || " " })}
            />
            <p className="text-xs text-muted-foreground">
              Plusieurs adresses possibles, séparées par des virgules — chacune reçoit son
              e-mail. Les variables ({"{{prenom}}"}, {"{{depart}}"}…) restent celles du dossier
              concerné.
            </p>
          </div>
        )}
        <div className="space-y-1.5">
          <Label>Sujet</Label>
          <Input
            placeholder="Sujet de l'e-mail"
            value={form.subject}
            onChange={(e) => set({ subject: e.target.value })}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Message</Label>
          <textarea
            className="w-full rounded-md border bg-background px-3 py-2 text-sm font-mono text-[13px]"
            rows={14}
            placeholder="Bonjour {{prenom}},…"
            value={form.body}
            onChange={(e) => set({ body: e.target.value })}
          />
          <p className="text-xs text-muted-foreground">
            Variables disponibles : <code className="text-[11px]">{VARIABLES}</code>
            <br />
            HTML autorisé (sanitisé à l&apos;envoi). Sans balise, les retours à la ligne sont
            conservés.
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.active}
            onChange={(e) => set({ active: e.target.checked })}
          />
          Actif (envoyé par le planificateur)
        </label>
      </div>
    </Modal>
  );
}
