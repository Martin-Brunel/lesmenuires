"use client";

import { useEffect, useState } from "react";
import { adminApi, type AdminProperty } from "@/lib/admin-api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { PhotosManager } from "@/components/admin/PhotosManager";
import { RichTextEditor } from "@/components/admin/RichTextEditor";
import { cn } from "@/lib/utils";

const SLUG = "ladret";

type Tab = "presentation" | "sejour" | "paiement" | "proprietaire" | "photos";

const TABS: { key: Tab; label: string }[] = [
  { key: "presentation", label: "Présentation" },
  { key: "sejour", label: "Séjour & accès" },
  { key: "paiement", label: "Paiement & taxe" },
  { key: "proprietaire", label: "Propriétaire" },
  { key: "photos", label: "Photos" },
];

export default function EditorialPage() {
  const [p, setP] = useState<AdminProperty | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [tab, setTab] = useState<Tab>("presentation");

  useEffect(() => {
    adminApi.getProperty(SLUG).then(setP).catch(() => setLoadError(true));
  }, []);

  const set = <K extends keyof AdminProperty>(k: K, v: AdminProperty[K]) =>
    setP((prev) => (prev ? { ...prev, [k]: v } : prev));

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!p) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const { slug, ...data } = p;
      void slug;
      const updated = await adminApi.updateProperty(SLUG, data);
      setP(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    } finally {
      setSaving(false);
    }
  };

  if (loadError) {
    return <div className="text-sm text-destructive">Impossible de charger la fiche. Rechargez la page.</div>;
  }
  if (!p) {
    return <div className="text-sm text-muted-foreground">Chargement…</div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Contenu éditorial</h1>
        <p className="text-sm text-muted-foreground">
          Informations du logement : site public, espace client et conditions financières.
        </p>
      </div>

      <div className="flex gap-1 border-b overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={cn(
              "px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap",
              tab === t.key
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab !== "photos" && (
        <form onSubmit={save}>
          <Card>
            <CardContent className="pt-6 space-y-5">
              {tab === "presentation" && (
                <>
                  <p className="text-sm text-muted-foreground">
                    Ce que voient les visiteurs du site public.
                  </p>
                  <Field label="Nom du logement">
                    <Input value={p.name} onChange={(e) => set("name", e.target.value)} />
                  </Field>
                  <Field label="Lieu (sous-titre)" hint="Ex. : Le Grand-Bornand · 1 280 m">
                    <Input
                      value={p.locationLabel}
                      onChange={(e) => set("locationLabel", e.target.value)}
                    />
                  </Field>
                  <Field
                    label="Description"
                    hint="Gras, italique, titres, listes et liens. Le texte est tronqué sur le site avec un « Voir plus »."
                  >
                    <RichTextEditor
                      value={p.description}
                      onChange={(html) => set("description", html)}
                    />
                  </Field>
                  <Field
                    label="Spécifications (ligne)"
                    hint="Ex. : 95 m² · 6 voyageurs · 3 chambres…"
                  >
                    <Input
                      value={p.specsLabel}
                      onChange={(e) => set("specsLabel", e.target.value)}
                    />
                  </Field>
                  <div className="grid grid-cols-2 gap-4">
                    <Field label="Surface (libellé)">
                      <Input
                        value={p.surfaceLabel}
                        onChange={(e) => set("surfaceLabel", e.target.value)}
                      />
                    </Field>
                    <Field label="Mise en avant" hint="Ex. : Sauna & cheminée">
                      <Input
                        value={p.highlightLabel}
                        onChange={(e) => set("highlightLabel", e.target.value)}
                      />
                    </Field>
                    <Field label="Voyageurs" hint="Capacité maximale — borne les réservations.">
                      <Input
                        type="number"
                        min={1}
                        value={p.capacity}
                        onChange={(e) => set("capacity", Number(e.target.value))}
                      />
                    </Field>
                    <Field label="Chambres">
                      <Input
                        type="number"
                        min={0}
                        value={p.bedrooms}
                        onChange={(e) => set("bedrooms", Number(e.target.value))}
                      />
                    </Field>
                  </div>
                </>
              )}

              {tab === "sejour" && (
                <>
                  <p className="text-sm text-muted-foreground">
                    Ce que reçoit le client avant et pendant son séjour (espace client,
                    e-mails automatiques).
                  </p>
                  <Field
                    label="Consignes d'arrivée"
                    hint="Espace client avant le séjour, et variable {{acces}} des e-mails automatiques (récupération des clés, parking, horaires…)."
                  >
                    <textarea
                      className="flex min-h-[140px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      value={p.arrivalInstructions}
                      onChange={(e) => set("arrivalInstructions", e.target.value)}
                    />
                  </Field>
                  <Field
                    label="Règlement intérieur"
                    hint="Une règle par ligne — affichée en liste dans l'espace client."
                  >
                    <textarea
                      className="flex min-h-[140px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      value={p.houseRules}
                      onChange={(e) => set("houseRules", e.target.value)}
                    />
                  </Field>
                </>
              )}

              {tab === "paiement" && (
                <>
                  <p className="text-sm text-muted-foreground">
                    Conditions financières appliquées aux nouvelles réservations (les
                    dossiers existants gardent leurs montants).
                  </p>
                  <div className="grid grid-cols-2 gap-4">
                    <Field label="Acompte (%)" hint="Payé à la réservation ; le solde est prélevé à J-14.">
                      <Input
                        type="number"
                        min={0}
                        max={100}
                        value={p.depositPct}
                        onChange={(e) => set("depositPct", Number(e.target.value))}
                      />
                    </Field>
                    <Field
                      label="Caution (€)"
                      hint="Garantie : carte enregistrée débitée uniquement en cas de dégâts."
                    >
                      <Input
                        type="number"
                        min={0}
                        step={50}
                        value={p.cautionCents / 100}
                        onChange={(e) =>
                          set("cautionCents", Math.round(Number(e.target.value) * 100))
                        }
                      />
                    </Field>
                    <Field label="Taxe de séjour (€ / adulte / nuit)" hint="Mineurs exonérés.">
                      <Input
                        type="number"
                        min={0}
                        step={0.01}
                        value={p.touristTaxCents / 100}
                        onChange={(e) =>
                          set("touristTaxCents", Math.round(Number(e.target.value) * 100))
                        }
                      />
                    </Field>
                    <Field label="Taxe de séjour — total">
                      <label className="flex items-center gap-2 text-sm h-9">
                        <input
                          type="checkbox"
                          checked={p.touristTaxIncluded}
                          onChange={(e) => set("touristTaxIncluded", e.target.checked)}
                        />
                        Incluse dans le total du dossier
                      </label>
                    </Field>
                  </div>
                </>
              )}

              {tab === "proprietaire" && (
                <>
                  <p className="text-sm text-muted-foreground">
                    Identité du bailleur — affichée dans les contrats de location et sur les
                    factures / quittances.
                  </p>
                  <Field label="Nom / raison sociale" hint="Ex. : Martin Brunel ou SCI Les Cimes">
                    <Input
                      value={p.ownerName}
                      onChange={(e) => set("ownerName", e.target.value)}
                    />
                  </Field>
                  <Field label="Adresse" hint="Adresse complète du bailleur (contrat).">
                    <Input
                      value={p.ownerAddress}
                      onChange={(e) => set("ownerAddress", e.target.value)}
                    />
                  </Field>
                  <div className="grid grid-cols-2 gap-4">
                    <Field label="Téléphone">
                      <Input
                        value={p.ownerPhone}
                        onChange={(e) => set("ownerPhone", e.target.value)}
                      />
                    </Field>
                    <Field label="E-mail">
                      <Input
                        type="email"
                        value={p.ownerEmail}
                        onChange={(e) => set("ownerEmail", e.target.value)}
                      />
                    </Field>
                    <Field label="SIRET (facultatif)" hint="Affiché sur les factures si renseigné.">
                      <Input
                        value={p.ownerSiret}
                        onChange={(e) => set("ownerSiret", e.target.value)}
                      />
                    </Field>
                  </div>
                </>
              )}

              <div className="flex items-center gap-3 pt-2 border-t">
                <Button type="submit" disabled={saving}>
                  {saving ? "Enregistrement…" : "Enregistrer"}
                </Button>
                {saved && <span className="text-sm text-emerald-600">Enregistré ✓</span>}
                {error && <span className="text-sm text-destructive">{error}</span>}
                <span className="text-xs text-muted-foreground ml-auto">
                  Enregistre tous les onglets d&apos;un coup.
                </span>
              </div>
            </CardContent>
          </Card>
        </form>
      )}

      {tab === "photos" && <PhotosManager slug={SLUG} />}
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
