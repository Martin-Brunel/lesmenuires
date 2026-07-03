"use client";

import { useEffect, useState } from "react";
import {
  adminApi,
  type AdminAccount,
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

export default function EquipePage() {
  const confirm = useConfirm();
  const [me, setMe] = useState<Me | null>(null);
  const [accounts, setAccounts] = useState<AdminAccount[] | null>(null);
  const [error, setError] = useState(false);

  const reload = () =>
    Promise.all([adminApi.me(), adminApi.listAdminUsers()])
      .then(([m, a]) => {
        setMe(m);
        setAccounts(a);
      })
      .catch(() => setError(true));
  useEffect(() => {
    reload();
  }, []);

  const reinvite = async (a: AdminAccount) => {
    try {
      await adminApi.reinviteAdminUser(a.id);
      toast.success(`Invitation renvoyée à ${a.email}.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    }
  };

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
          Comptes du back-office.
          {me.isSuper
            ? " Vous êtes le compte principal : vous seul pouvez inviter ou supprimer des comptes."
            : " Seul le compte principal peut inviter ou supprimer des comptes."}{" "}
          Vos informations personnelles se gèrent dans « Mon compte ».
        </p>
      </div>

      <div className="grid gap-4">
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
                      {a.pending && <Badge variant="warning">Invitation en attente</Badge>}
                      {a.id === me.id && <Badge variant="muted">Vous</Badge>}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {a.email} · créé le {dt(a.createdAt)}
                    </div>
                  </div>
                  {me.isSuper && a.pending && (
                    <Button size="sm" variant="secondary" onClick={() => reinvite(a)}>
                      Renvoyer l&apos;invitation
                    </Button>
                  )}
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
      </div>

    </div>
  );
}

function CreateAccountForm({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);

  const create = async () => {
    if (busy) return;
    if (!displayName.trim() || !/.+@.+\..+/.test(email)) {
      toast.error("Nom et e-mail valide requis.");
      return;
    }
    setBusy(true);
    try {
      await adminApi.createAdminUser({ email, displayName });
      toast.success(`Invitation envoyée à ${email}.`);
      setOpen(false);
      setDisplayName("");
      setEmail("");
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
        Inviter un compte
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
      <p className="text-xs text-muted-foreground">
        La personne reçoit un e-mail d&apos;invitation (valable 7 jours) avec un lien pour
        définir elle-même son mot de passe.
      </p>
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
          Annuler
        </Button>
        <Button size="sm" onClick={create} disabled={busy}>
          {busy ? "…" : "Envoyer l'invitation"}
        </Button>
      </div>
    </div>
  );
}

// Le mot de passe et le profil se gèrent désormais sur /admin/compte.
