"use client";

import { useEffect, useState } from "react";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ExternalLink, GripVertical, Trash2 } from "lucide-react";
import {
  adminApi,
  type AdminProperty,
  type GlobalSettings,
  type PropertyTranslations,
} from "@/lib/admin-api";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { PhotosManager } from "@/components/admin/PhotosManager";
import { RichTextEditor } from "@/components/admin/RichTextEditor";
import { contractText } from "@/lib/contract";
import { cn } from "@/lib/utils";
import { AmenityIconGlyph } from "@/components/AmenityIconGlyph";
import { AMENITY_ICON_OPTIONS, type Amenity } from "@/lib/amenities";

const SLUG = "ladret";

type Tab =
  | "presentation"
  | "sejour"
  | "equipements"
  | "paiement"
  | "proprietaire"
  | "contrat"
  | "english"
  | "photos";

const TABS: { key: Tab; label: string }[] = [
  { key: "presentation", label: "Présentation" },
  { key: "equipements", label: "Équipements" },
  { key: "sejour", label: "Séjour & accès" },
  { key: "paiement", label: "Paiement & taxe" },
  { key: "proprietaire", label: "Propriétaire" },
  { key: "contrat", label: "Contrat" },
  { key: "english", label: "English 🇬🇧" },
  { key: "photos", label: "Photos" },
];

/** Champs EN éditables (site public anglais). Vide = repli sur le français. */
type EnFields = NonNullable<PropertyTranslations["en"]>;

export default function EditorialPage() {
  const [p, setP] = useState<AdminProperty | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [tab, setTab] = useState<Tab>("presentation");
  const [tr, setTr] = useState<EnFields | null>(null);
  const [settings, setSettings] = useState<GlobalSettings | null>(null);

  useEffect(() => {
    adminApi.getProperty(SLUG).then(setP).catch(() => setLoadError(true));
    adminApi.getSettings().then(setSettings).catch(() => {});
    adminApi
      .getPropertyTranslations(SLUG)
      .then((t) => setTr(t.en ?? {}))
      .catch(() => setTr({}));
  }, []);

  useEffect(() => {
    if (settings?.englishEnabled === false && tab === "english") setTab("presentation");
  }, [settings?.englishEnabled, tab]);

  const set = <K extends keyof AdminProperty>(k: K, v: AdminProperty[K]) =>
    setP((prev) => (prev ? { ...prev, [k]: v } : prev));
  const setEn = <K extends keyof EnFields>(k: K, v: string) =>
    setTr((prev) => ({ ...(prev ?? {}), [k]: v }));

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
      if (settings?.englishEnabled && tr) {
        const saved = await adminApi.updatePropertyTranslations(SLUG, { en: tr });
        setTr(saved.en ?? {});
      }
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
  const englishEnabled = settings?.englishEnabled ?? true;
  const tabs = englishEnabled ? TABS : TABS.filter((t) => t.key !== "english");

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Contenu éditorial</h1>
          <p className="text-sm text-muted-foreground">
            Informations du logement : site public, espace client et conditions financières.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2 pt-1">
          <a
            href="/"
            target="_blank"
            rel="noopener"
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            <ExternalLink className="size-4" />
            Voir le site
          </a>
          {englishEnabled && (
            <a
              href="/en"
              target="_blank"
              rel="noopener"
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              <ExternalLink className="size-4" />
              English
            </a>
          )}
        </div>
      </div>

      <div className="flex gap-1 border-b overflow-x-auto">
        {tabs.map((t) => (
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

      {tab !== "photos" && (englishEnabled || tab !== "english") && tab !== "english" && (
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
                    <RichTextEditor
                      value={p.arrivalInstructions}
                      onChange={(html) => set("arrivalInstructions", html)}
                    />
                  </Field>
                  <Field
                    label="Règlement intérieur"
                    hint="Utilisez une liste à puces — affiché tel quel dans l'espace client."
                  >
                    <RichTextEditor
                      value={p.houseRules}
                      onChange={(html) => set("houseRules", html)}
                    />
                  </Field>
                </>
              )}

              {tab === "equipements" && (
                <AmenitiesEditor
                  value={p.amenities ?? []}
                  englishEnabled={englishEnabled}
                  onChange={(amenities) => set("amenities", amenities)}
                />
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

              {tab === "contrat" && (
                <>
                  <p className="text-sm text-muted-foreground">
                    Texte du contrat signé par le client à la réservation. Laissez vide pour
                    utiliser le texte par défaut. Les contrats déjà signés ne sont jamais
                    modifiés (le texte exact signé est archivé sur chaque dossier).
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Variables disponibles :{" "}
                    <code className="rounded bg-muted px-1 py-0.5">{"{{bailleur}}"}</code>{" "}
                    (identité du propriétaire, construite depuis l&apos;onglet Propriétaire),{" "}
                    <code className="rounded bg-muted px-1 py-0.5">{"{{nom}}"}</code> (nom du
                    bien),{" "}
                    <code className="rounded bg-muted px-1 py-0.5">{"{{localisation}}"}</code>,{" "}
                    <code className="rounded bg-muted px-1 py-0.5">{"{{capacite}}"}</code>,{" "}
                    <code className="rounded bg-muted px-1 py-0.5">{"{{caution}}"}</code>.
                  </p>
                  <Field label="Texte du contrat">
                    <textarea
                      rows={14}
                      className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 font-mono text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      value={p.contractTemplate}
                      onChange={(e) => set("contractTemplate", e.target.value)}
                    />
                  </Field>
                  {p.contractTemplate.trim() === "" ? (
                    <div className="rounded-md border bg-muted/50 p-4 space-y-2">
                      <p className="text-xs font-medium text-muted-foreground">
                        Texte par défaut actuellement utilisé :
                      </p>
                      <p className="text-sm text-muted-foreground whitespace-pre-line">
                        {contractText({
                          propertyName: p.name,
                          locationLabel: p.locationLabel,
                          cautionCents: p.cautionCents,
                          capacity: p.capacity,
                          ownerName: p.ownerName,
                          ownerAddress: p.ownerAddress,
                        })}
                      </p>
                    </div>
                  ) : (
                    <div className="rounded-md border bg-muted/50 p-4 space-y-2">
                      <p className="text-xs font-medium text-muted-foreground">
                        Aperçu avec les variables remplacées :
                      </p>
                      <p className="text-sm text-muted-foreground whitespace-pre-line">
                        {contractText({
                          propertyName: p.name,
                          locationLabel: p.locationLabel,
                          cautionCents: p.cautionCents,
                          capacity: p.capacity,
                          ownerName: p.ownerName,
                          ownerAddress: p.ownerAddress,
                          template: p.contractTemplate,
                        })}
                      </p>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="text-muted-foreground"
                        onClick={() => set("contractTemplate", "")}
                      >
                        Revenir au texte par défaut
                      </Button>
                    </div>
                  )}
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

      {englishEnabled && tab === "english" && (
        <form onSubmit={save}>
          <Card>
            <CardContent className="pt-6 space-y-5">
              <p className="text-sm text-muted-foreground">
                Version anglaise des contenus du site public (/en) et des e-mails aux
                clients anglophones. Un champ vide affiche le texte français.
              </p>
              {!tr ? (
                <p className="text-sm text-muted-foreground">Chargement…</p>
              ) : (
                <>
                  <Field label="Description (EN)">
                    <RichTextEditor
                      value={tr.description ?? ""}
                      onChange={(html) => setEn("description", html)}
                    />
                  </Field>
                  <div className="grid grid-cols-2 gap-4">
                    <Field label="Lieu / sous-titre (EN)" hint={`FR : ${p.locationLabel}`}>
                      <Input
                        value={tr.locationLabel ?? ""}
                        onChange={(e) => setEn("locationLabel", e.target.value)}
                      />
                    </Field>
                    <Field label="Spécifications (EN)" hint={`FR : ${p.specsLabel}`}>
                      <Input
                        value={tr.specsLabel ?? ""}
                        onChange={(e) => setEn("specsLabel", e.target.value)}
                      />
                    </Field>
                    <Field label="Surface (EN)" hint={`FR : ${p.surfaceLabel}`}>
                      <Input
                        value={tr.surfaceLabel ?? ""}
                        onChange={(e) => setEn("surfaceLabel", e.target.value)}
                      />
                    </Field>
                    <Field label="Mise en avant (EN)" hint={`FR : ${p.highlightLabel}`}>
                      <Input
                        value={tr.highlightLabel ?? ""}
                        onChange={(e) => setEn("highlightLabel", e.target.value)}
                      />
                    </Field>
                  </div>
                  <Field label="Consignes d'arrivée (EN)">
                    <RichTextEditor
                      value={tr.arrivalInstructions ?? ""}
                      onChange={(html) => setEn("arrivalInstructions", html)}
                    />
                  </Field>
                  <Field label="Règlement intérieur (EN)">
                    <RichTextEditor
                      value={tr.houseRules ?? ""}
                      onChange={(html) => setEn("houseRules", html)}
                    />
                  </Field>
                  <Field
                    label="Contrat (EN)"
                    hint="Mêmes variables que le contrat français ({{bailleur}}, {{nom}}, {{localisation}}, {{capacite}}, {{caution}}). Vide = texte anglais par défaut."
                  >
                    <textarea
                      rows={10}
                      className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 font-mono text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      value={tr.contractTemplate ?? ""}
                      onChange={(e) => setEn("contractTemplate", e.target.value)}
                    />
                  </Field>
                  <div className="grid grid-cols-2 gap-4">
                    <Field label="Instructions chèque (EN)">
                      <textarea
                        rows={4}
                        className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                        value={tr.instructionsCheque ?? ""}
                        onChange={(e) => setEn("instructionsCheque", e.target.value)}
                      />
                    </Field>
                    <Field label="Instructions virement (EN)">
                      <textarea
                        rows={4}
                        className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                        value={tr.instructionsVirement ?? ""}
                        onChange={(e) => setEn("instructionsVirement", e.target.value)}
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

function AmenitiesEditor({
  value,
  englishEnabled,
  onChange,
}: {
  value: Amenity[];
  englishEnabled: boolean;
  onChange: (amenities: Amenity[]) => void;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );
  const itemIds = value.map((_, idx) => `amenity-${idx}`);
  const update = (idx: number, patch: Partial<Amenity>) =>
    onChange(value.map((a, i) => (i === idx ? { ...a, ...patch } : a)));
  const remove = (idx: number) => onChange(value.filter((_, i) => i !== idx));
  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = itemIds.indexOf(String(active.id));
    const to = itemIds.indexOf(String(over.id));
    if (from === -1 || to === -1) return;
    onChange(arrayMove(value, from, to));
  };
  const add = () =>
    onChange([
      ...value,
      { icon: "home", label: "Nouvel équipement", labelEn: "" },
    ]);

  return (
    <>
      <p className="text-sm text-muted-foreground">
        Liste affichée sur la page publique avec pictogrammes. L&apos;ordre ici est
        l&apos;ordre d&apos;affichage sur le site. Glissez une ligne pour la réordonner.
      </p>
      {value.length === 0 ? (
        <p className="rounded-md border bg-muted/30 p-4 text-sm text-muted-foreground">
          Aucun équipement configuré.
        </p>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={itemIds} strategy={verticalListSortingStrategy}>
            <div className="space-y-3">
              {value.map((a, idx) => (
                <SortableAmenityRow
                  key={itemIds[idx]}
                  id={itemIds[idx]}
                  amenity={a}
                  englishEnabled={englishEnabled}
                  onUpdate={(patch) => update(idx, patch)}
                  onRemove={() => remove(idx)}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}
      <Button type="button" variant="secondary" size="sm" onClick={add}>
        Ajouter un équipement
      </Button>
    </>
  );
}

function SortableAmenityRow({
  id,
  amenity,
  englishEnabled,
  onUpdate,
  onRemove,
}: {
  id: string;
  amenity: Amenity;
  englishEnabled: boolean;
  onUpdate: (patch: Partial<Amenity>) => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        englishEnabled
          ? "grid grid-cols-[auto_minmax(240px,1.05fr)_1fr_1fr_auto] items-start gap-3 rounded-md border bg-background p-3"
          : "grid grid-cols-[auto_minmax(240px,1.05fr)_1fr_auto] items-start gap-3 rounded-md border bg-background p-3",
        isDragging && "z-10 opacity-70 shadow-lg",
      )}
    >
      <div className="pt-[25px]">
        <button
          type="button"
          {...attributes}
          {...listeners}
          aria-label="Déplacer l'équipement"
          className="inline-flex h-9 w-8 items-center justify-center rounded-md border bg-muted/40 text-muted-foreground cursor-grab active:cursor-grabbing touch-none"
        >
          <GripVertical className="size-4" />
        </button>
      </div>
      <Field label="Pictogramme">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-10 shrink-0 items-center justify-center rounded-md border bg-muted/30 text-foreground">
            <AmenityIconGlyph icon={amenity.icon} size={21} />
          </div>
          <select
            className="flex h-9 min-w-0 flex-1 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            value={amenity.icon}
            onChange={(e) => onUpdate({ icon: e.target.value as Amenity["icon"] })}
          >
            {AMENITY_ICON_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </Field>
      <Field label="Libellé FR">
        <Input
          value={amenity.label}
          maxLength={80}
          onChange={(e) => onUpdate({ label: e.target.value })}
        />
      </Field>
      {englishEnabled && (
        <Field label="Libellé EN">
          <Input
            value={amenity.labelEn ?? ""}
            maxLength={80}
            placeholder={amenity.label}
            onChange={(e) => onUpdate({ labelEn: e.target.value })}
          />
        </Field>
      )}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="mt-[25px] h-9 w-9 text-destructive hover:text-destructive"
        onClick={onRemove}
        title="Supprimer"
      >
        <Trash2 className="size-4" />
      </Button>
    </div>
  );
}
