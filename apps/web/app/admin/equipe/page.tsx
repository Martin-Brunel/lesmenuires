"use client";

import { useEffect, useState } from "react";
import {
  adminApi,
  type AdminAccount,
  type AuditEntry,
  type Me,
} from "@/lib/admin-api";
import { Avatar } from "@/components/admin/Avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/toast";
import { useConfirm } from "@/components/admin/dialogs";

const dt = (iso: string) =>
  new Date(iso).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });

/** Traduit une entrée du journal (méthode + chemin) en action lisible. */
function humanize(e: AuditEntry): string {
  const p = e.path.replace(/^\/api\/admin/, "");
  const ref = p.match(/\/bookings\/([A-Z0-9-]+)\//)?.[1];
  const rules: [RegExp, string][] = [
    [/^\/login$/, "Connexion"],
    [/\/mark-paid$/, `Échéance pointée${ref ? ` · ${ref}` : ""}`],
    [/\/refund$/, `Remboursement · ${ref}`],
    [/\/cancel$/, `Annulation · ${ref}`],
    [/\/caution\/capture$/, `Caution débitée · ${ref}`],
    [/\/caution\/release$/, `Caution clôturée · ${ref}`],
    [/\/clear-flag$/, `Incident levé · ${ref}`],
    [/^\/bookings\/manual$/, "Réservation manuelle créée"],
    [/^\/bookings\/[^/]+\/note$/, `Note ajoutée · ${ref ?? "dossier"}`],
    [/^\/bookings\/[^/]+\/email$/, `E-mail envoyé · ${ref ?? "dossier"}`],
    [/^\/contacts\/[^/]+\/email$/, "E-mail envoyé à un contact"],
    [/^\/contacts\/[^/]+\/note$/, "Note ajoutée sur un contact"],
    [/^\/contacts\/[^/]+$/, "Fiche contact modifiée"],
    [/^\/property\//, e.method === "POST" ? "Photo ajoutée" : "Contenu éditorial modifié"],
    [/^\/media\//, e.method === "DELETE" ? "Photo supprimée" : "Photo modifiée"],
    [/^\/seasons$/, "Saison créée"],
    [/^\/seasons\//, e.method === "DELETE" ? "Saison supprimée" : "Saison modifiée"],
    [/^\/weeks\/generate$/, "Semaines générées"],
    [/^\/weeks\//, e.method === "DELETE" ? "Semaine supprimée" : "Semaine modifiée"],
    [/^\/products$/, "Prestation créée"],
    [/^\/products\//, e.method === "DELETE" ? "Prestation supprimée" : "Prestation modifiée"],
    [/^\/email-automations$/, "Transactionnel créé"],
    [
      /^\/email-automations\//,
      e.method === "DELETE" ? "Transactionnel supprimé" : "Transactionnel modifié",
    ],
    [/^\/users$/, "Compte admin créé"],
    [/^\/users\//, "Compte admin supprimé"],
    [/^\/me\/password$/, "Mot de passe modifié"],
    [/^\/scheduler\/run$/, "Planificateur lancé manuellement"],
    [/^\/logout$/, "Déconnexion"],
  ];
  for (const [re, label] of rules) if (re.test(p) || re.test(e.path)) return label;
  return `${e.method} ${p}`;
}

export default function EquipePage() {
  const confirm = useConfirm();
  const [me, setMe] = useState<Me | null>(null);
  const [accounts, setAccounts] = useState<AdminAccount[] | null>(null);
  const [audit, setAudit] = useState<AuditEntry[] | null>(null);
  const [error, setError] = useState(false);

  const reload = () =>
    Promise.all([adminApi.me(), adminApi.listAdminUsers(), adminApi.listAudit()])
      .then(([m, a, j]) => {
        setMe(m);
        setAccounts(a);
        setAudit(j);
      })
      .catch(() => setError(true));
  useEffect(() => {
    reload();
  }, []);

  const remove = async (a: AdminAccount) => {
    if (
      !(await confirm({
        title: "Supprimer ce compte ?",
        description: `${a.displayName || a.email} ne pourra plus se connecter. Ses actions restent dans le journal.`,
        danger: true,
        confirmLabel: "Supprimer",
      }))
    )
      return;
    try {
      await adminApi.deleteAdminUser(a.id);
      toast.success("Compte supprimé.");
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    }
  };

  if (error) return <p className="text-sm text-destructive">Impossible de charger la page.</p>;
  if (!me || !accounts) return <p className="text-sm text-muted-foreground">Chargement…</p>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Équipe</h1>
        <p className="text-sm text-muted-foreground">
          Comptes du back-office et journal des actions. Chaque action est signée par son
          auteur.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Comptes ({accounts.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y">
              {accounts.map((a) => (
                <li key={a.id} className="flex items-center gap-3 py-2.5">
                  <Avatar name={a.displayName || a.email} size={34} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <span className="truncate">{a.displayName || a.email}</span>
                      {a.isSuper && <Badge variant="success">Compte principal</Badge>}
                      {a.id === me.id && <Badge variant="muted">Vous</Badge>}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {a.email} · créé le {dt(a.createdAt)}
                    </div>
                  </div>
                  {me.isSuper && !a.isSuper && a.id !== me.id && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive hover:text-destructive"
                      onClick={() => remove(a)}
                    >
                      Supprimer
                    </Button>
                  )}
                </li>
              ))}
            </ul>
            {me.isSuper && <CreateAccountForm onCreated={reload} />}
          </CardContent>
        </Card>

        <PasswordCard />
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Journal d&apos;activité</CardTitle>
        </CardHeader>
        <CardContent>
          {!audit || audit.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucune action enregistrée.</p>
          ) : (
            <ul className="divide-y">
              {audit.map((e, i) => (
                <li key={i} className="flex items-center gap-3 py-2 text-sm">
                  <Avatar name={e.adminName} size={26} />
                  <span className="font-medium">{e.adminName}</span>
                  <span className="text-muted-foreground min-w-0 flex-1 truncate">
                    {humanize(e)}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {dt(e.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function CreateAccountForm({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const create = async () => {
    if (busy) return;
    if (!displayName.trim() || !/.+@.+\..+/.test(email) || password.length < 8) {
      toast.error("Nom, e-mail valide et mot de passe (8 caractères min.) requis.");
      return;
    }
    setBusy(true);
    try {
      await adminApi.createAdminUser({ email, displayName, password });
      toast.success("Compte créé.");
      setOpen(false);
      setDisplayName("");
      setEmail("");
      setPassword("");
      onCreated();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <Button size="sm" className="mt-3" onClick={() => setOpen(true)}>
        Nouveau compte
      </Button>
    );
  }
  return (
    <div className="mt-4 space-y-3 rounded-md border p-4">
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1.5">
          <Label>Nom</Label>
          <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>E-mail</Label>
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label>Mot de passe provisoire</Label>
        <Input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          8 caractères minimum — la personne pourra le changer une fois connectée.
        </p>
      </div>
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
          Annuler
        </Button>
        <Button size="sm" onClick={create} disabled={busy}>
          {busy ? "…" : "Créer le compte"}
        </Button>
      </div>
    </div>
  );
}

function PasswordCard() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirmNext, setConfirmNext] = useState("");
  const [busy, setBusy] = useState(false);

  const change = async () => {
    if (busy) return;
    if (next.length < 8) {
      toast.error("Nouveau mot de passe : 8 caractères minimum.");
      return;
    }
    if (next !== confirmNext) {
      toast.error("La confirmation ne correspond pas.");
      return;
    }
    setBusy(true);
    try {
      await adminApi.changeMyPassword(current, next);
      toast.success("Mot de passe modifié.");
      setCurrent("");
      setNext("");
      setConfirmNext("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Mon mot de passe</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1.5">
          <Label>Mot de passe actuel</Label>
          <Input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1.5">
            <Label>Nouveau</Label>
            <Input type="password" value={next} onChange={(e) => setNext(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Confirmation</Label>
            <Input
              type="password"
              value={confirmNext}
              onChange={(e) => setConfirmNext(e.target.value)}
            />
          </div>
        </div>
        <Button size="sm" onClick={change} disabled={busy || !current || !next}>
          {busy ? "…" : "Changer le mot de passe"}
        </Button>
      </CardContent>
    </Card>
  );
}
