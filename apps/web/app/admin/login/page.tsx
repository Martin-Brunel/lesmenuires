"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { adminApi } from "@/lib/admin-api";
import { site } from "@/lib/site";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [forgot, setForgot] = useState(false);
  const [forgotSent, setForgotSent] = useState(false);

  const sendForgot = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading || !email) return;
    setLoading(true);
    setError(null);
    try {
      await adminApi.forgotPassword(email);
      setForgotSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    } finally {
      setLoading(false);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await adminApi.login(email, password);
      router.replace("/admin");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur de connexion");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle className="text-xl" style={{ fontFamily: "'Marcellus',serif" }}>
          Back-office {site.name}
        </CardTitle>
        <CardDescription>
          {forgot
            ? "Recevez un lien pour définir un nouveau mot de passe."
            : "Connectez-vous pour gérer la location."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {forgot ? (
          forgotSent ? (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Si un compte existe pour <strong>{email}</strong>, un e-mail vient de lui être
                envoyé (lien valable 1 heure).
              </p>
              <Button
                variant="secondary"
                className="w-full"
                onClick={() => {
                  setForgot(false);
                  setForgotSent(false);
                }}
              >
                Retour à la connexion
              </Button>
            </div>
          ) : (
            <form onSubmit={sendForgot} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="femail">E-mail du compte</Label>
                <Input
                  id="femail"
                  type="email"
                  autoComplete="username"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? "…" : "Envoyer le lien"}
              </Button>
              <button
                type="button"
                className="w-full text-center text-sm text-muted-foreground underline underline-offset-2"
                onClick={() => setForgot(false)}
              >
                Retour à la connexion
              </button>
            </form>
          )
        ) : (
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="email">E-mail</Label>
            <Input
              id="email"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pw">Mot de passe</Label>
            <Input
              id="pw"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Connexion…" : "Se connecter"}
          </Button>
          <button
            type="button"
            className="w-full text-center text-sm text-muted-foreground underline underline-offset-2"
            onClick={() => {
              setForgot(true);
              setError(null);
            }}
          >
            Mot de passe oublié ?
          </button>
        </form>
        )}
      </CardContent>
    </Card>
  );
}
