"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { adminApi } from "@/lib/admin-api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function SetPasswordForm() {
  const router = useRouter();
  const token = useSearchParams().get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (password.length < 8) {
      setError("8 caractères minimum.");
      return;
    }
    if (password !== confirm) {
      setError("La confirmation ne correspond pas.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await adminApi.setPassword(token, password);
      router.replace("/admin");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
      setBusy(false);
    }
  };

  if (!token) {
    return (
      <p className="text-sm text-destructive">
        Lien incomplet — utilisez le bouton de l&apos;e-mail reçu.
      </p>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="space-y-1.5">
        <Label>Nouveau mot de passe</Label>
        <Input
          type="password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">8 caractères minimum.</p>
      </div>
      <div className="space-y-1.5">
        <Label>Confirmation</Label>
        <Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" className="w-full" disabled={busy || !password || !confirm}>
        {busy ? "…" : "Définir le mot de passe et se connecter"}
      </Button>
    </form>
  );
}

export default function DefinirMotDePassePage() {
  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle className="text-lg">Définir votre mot de passe</CardTitle>
      </CardHeader>
      <CardContent>
        <Suspense fallback={<p className="text-sm text-muted-foreground">Chargement…</p>}>
          <SetPasswordForm />
        </Suspense>
      </CardContent>
    </Card>
  );
}
