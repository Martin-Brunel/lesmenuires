"use client";

import { useEffect, useState } from "react";
import { adminApi, type Me } from "@/lib/admin-api";
import { Avatar } from "@/components/admin/Avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/toast";

export default function ComptePage() {
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    adminApi.me().then(setMe).catch(() => setError(true));
  }, []);

  if (error) return <p className="text-sm text-destructive">Impossible de charger le compte.</p>;
  if (!me) return <p className="text-sm text-muted-foreground">Chargement…</p>;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Avatar name={me.displayName || me.email} size={44} />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Mon compte</h1>
          <p className="text-sm text-muted-foreground">
            {me.email}
            {me.isSuper && (
              <Badge variant="success" className="ml-2">
                Compte principal
              </Badge>
            )}
          </p>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ProfileCard me={me} onSaved={setMe} />
        <PasswordCard />
      </div>
    </div>
  );
}

function ProfileCard({ me, onSaved }: { me: Me; onSaved: (m: Me) => void }) {
  const [displayName, setDisplayName] = useState(me.displayName);
  const [email, setEmail] = useState(me.email);
  const [currentPassword, setCurrentPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const emailChanged = email.trim().toLowerCase() !== me.email.toLowerCase();
  const dirty = emailChanged || displayName.trim() !== me.displayName;

  const save = async () => {
    if (busy || !dirty) return;
    if (!displayName.trim()) {
      toast.error("Le nom affiché est requis.");
      return;
    }
    if (emailChanged && !currentPassword) {
      toast.error("Mot de passe actuel requis pour changer l'e-mail.");
      return;
    }
    setBusy(true);
    try {
      const updated = await adminApi.updateMe({
        displayName: displayName.trim(),
        email: email.trim(),
        currentPassword: emailChanged ? currentPassword : undefined,
      });
      onSaved(updated);
      setCurrentPassword("");
      toast.success("Compte mis à jour.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Profil</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1.5">
          <Label>Nom affiché</Label>
          <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          <p className="text-xs text-muted-foreground">
            Visible par l&apos;équipe et dans le journal d&apos;activité.
          </p>
        </div>
        <div className="space-y-1.5">
          <Label>E-mail de connexion</Label>
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        {emailChanged && (
          <div className="space-y-1.5 rounded-md border border-amber-300 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950/30">
            <Label>Mot de passe actuel</Label>
            <Input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
            />
            <p className="text-xs text-amber-800 dark:text-amber-300">
              L&apos;e-mail est votre identifiant de connexion : sa modification demande
              votre mot de passe. Utilisez ensuite le nouvel e-mail pour vous connecter.
            </p>
          </div>
        )}
        <Button size="sm" onClick={save} disabled={busy || !dirty}>
          {busy ? "…" : "Enregistrer"}
        </Button>
      </CardContent>
    </Card>
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
        <CardTitle className="text-base">Mot de passe</CardTitle>
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
