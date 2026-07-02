"use client";

import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { adminApi, type AdminSeason, type RateTier } from "@/lib/admin-api";
import { useConfirm } from "@/components/admin/dialogs";
import { toast } from "@/components/ui/toast";
import { frLong, frShort, todayIso } from "@/lib/dates";
import { DateField } from "@/components/admin/DateField";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const SLUG = "ladret";

const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "palier";

export default function SaisonsPage() {
  const [seasons, setSeasons] = useState<AdminSeason[] | null>(null);
  const [loadError, setLoadError] = useState(false);

  const load = () =>
    adminApi
      .listSeasons(SLUG)
      .then((s) => {
        setSeasons(s);
        setLoadError(false);
      })
      .catch(() => setLoadError(true));
  useEffect(() => {
    load();
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Saisons</h1>
        <p className="text-sm text-muted-foreground">
          Une saison regroupe les semaines proposées. Le site public n&apos;affiche que la saison
          active.
        </p>
      </div>

      {loadError && (
        <p className="text-sm text-destructive">
          Impossible de charger les saisons. Rechargez la page.
        </p>
      )}
      {!loadError && seasons === null && (
        <p className="text-sm text-muted-foreground">Chargement…</p>
      )}
      {!loadError && seasons?.length === 0 && (
        <p className="text-sm text-muted-foreground">Aucune saison. Créez-en une ci-dessous.</p>
      )}
      {!loadError &&
        seasons?.map((s) => (
        <SeasonCard key={s.id} season={s} onChanged={load} />
      ))}

      <CreateSeason onCreated={load} />
    </div>
  );
}

function SeasonCard({ season, onChanged }: { season: AdminSeason; onChanged: () => void }) {
  const [name, setName] = useState(season.name);
  const [startDate, setStart] = useState(season.startDate);
  const [endDate, setEnd] = useState(season.endDate);
  const [isActive, setActive] = useState(season.isActive);
  const [tiers, setTiers] = useState<{ label: string; euros: string }[]>(
    season.rateTiers.map((t) => ({ label: t.label, euros: (t.priceCents / 100).toString() })),
  );
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isPast = season.endDate < todayIso();
  const [expanded, setExpanded] = useState(!isPast);

  const setTier = (i: number, patch: Partial<{ label: string; euros: string }>) =>
    setTiers((ts) => ts.map((t, idx) => (idx === i ? { ...t, ...patch } : t)));
  const addTier = () => setTiers((ts) => [...ts, { label: "", euros: "" }]);
  const removeTier = (i: number) => setTiers((ts) => ts.filter((_, idx) => idx !== i));

  const save = async () => {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const seen = new Set<string>();
      const rateTiers: RateTier[] = tiers
        .filter((t) => t.label.trim() !== "")
        .map((t) => {
          let key = slugify(t.label);
          while (seen.has(key)) key += "-2";
          seen.add(key);
          return { key, label: t.label.trim(), priceCents: Math.round(parseFloat(t.euros || "0") * 100) };
        });
      await adminApi.updateSeason(season.id, { name, startDate, endDate, isActive, rateTiers });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (
      !(await confirm({
        title: "Supprimer la saison ?",
        description: `« ${season.name} » — les semaines liées seront détachées.`,
        danger: true,
        confirmLabel: "Supprimer",
      }))
    )
      return;
    setBusy(true);
    try {
      await adminApi.deleteSeason(season.id);
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
      setBusy(false);
    }
  };

  return (
    <Card>
      <div className="flex items-center justify-between p-6 pb-0 gap-3">
        <div className="min-w-0">
          <div className="font-semibold leading-none tracking-tight flex items-center gap-2 flex-wrap">
            {season.name}
            {season.isActive && <Badge variant="success">Active</Badge>}
            {isPast && <Badge variant="muted">Passée</Badge>}
          </div>
          <div className="text-xs text-muted-foreground mt-1.5">
            {frShort(season.startDate)} → {frShort(season.endDate)}
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Button size="sm" variant="ghost" onClick={() => setExpanded((x) => !x)}>
            {expanded ? "Réduire" : "Modifier"}
          </Button>
          <Button size="icon" variant="ghost" className="h-8 w-8" onClick={remove} disabled={busy}>
            <Trash2 className="size-4 text-destructive" />
          </Button>
        </div>
      </div>
      {expanded && (
      <CardContent className="space-y-4 pt-4">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="space-y-1.5 lg:col-span-2">
            <Label>Nom</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Début</Label>
            <DateField value={startDate} onChange={setStart} />
            {startDate && <p className="text-xs text-muted-foreground">{frLong(startDate)}</p>}
          </div>
          <div className="space-y-1.5">
            <Label>Fin</Label>
            <DateField value={endDate} onChange={setEnd} />
            {endDate && <p className="text-xs text-muted-foreground">{frLong(endDate)}</p>}
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
          <input type="checkbox" checked={isActive} onChange={(e) => setActive(e.target.checked)} />
          Saison active (affichée sur le site)
        </label>

        <div>
          <Label>Paliers tarifaires</Label>
          <div className="mt-2 space-y-2">
            {tiers.map((t, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input
                  value={t.label}
                  placeholder="Libellé (ex. Vacances scolaires)"
                  className="h-8"
                  onChange={(e) => setTier(i, { label: e.target.value })}
                />
                <div className="flex items-center gap-1 w-32 shrink-0">
                  <Input
                    type="number"
                    min={0}
                    step={10}
                    value={t.euros}
                    placeholder="Prix"
                    className="h-8"
                    onChange={(e) => setTier(i, { euros: e.target.value })}
                  />
                  <span className="text-muted-foreground text-sm">€</span>
                </div>
                <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0" onClick={() => removeTier(i)}>
                  <Trash2 className="size-4 text-muted-foreground" />
                </Button>
              </div>
            ))}
            <Button type="button" size="sm" variant="outline" onClick={addTier}>
              <Plus className="size-4" />
              Ajouter un palier
            </Button>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Button onClick={save} disabled={busy}>
            {busy ? "…" : saved ? "Enregistré ✓" : "Enregistrer"}
          </Button>
          {error && <span className="text-sm text-destructive">{error}</span>}
        </div>
      </CardContent>
      )}
    </Card>
  );
}

function CreateSeason({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState("");
  const [startDate, setStart] = useState("");
  const [endDate, setEnd] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await adminApi.createSeason({
        slug: SLUG,
        name,
        startDate,
        endDate,
        rateTiers: [
          { key: "basse", label: "Basse saison", priceCents: 99000 },
          { key: "haute", label: "Haute saison", priceCents: 129000 },
          { key: "vacances", label: "Vacances scolaires", priceCents: 169000 },
        ],
      });
      setName("");
      setStart("");
      setEnd("");
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Nouvelle saison</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={create} className="grid grid-cols-2 lg:grid-cols-4 gap-3 items-end">
          <div className="space-y-1.5 lg:col-span-2">
            <Label>Nom</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Hiver 2026 – 2027" required />
          </div>
          <div className="space-y-1.5">
            <Label>Début</Label>
            <DateField value={startDate} onChange={setStart} />
            {startDate && <p className="text-xs text-muted-foreground">{frLong(startDate)}</p>}
          </div>
          <div className="space-y-1.5">
            <Label>Fin</Label>
            <DateField value={endDate} onChange={setEnd} />
            {endDate && <p className="text-xs text-muted-foreground">{frLong(endDate)}</p>}
          </div>
          <Button type="submit" disabled={busy} className="lg:col-span-4 w-fit">
            {busy ? "…" : "Créer la saison"}
          </Button>
        </form>
        <p className="text-xs text-muted-foreground mt-2">
          Trois paliers par défaut sont créés (basse / haute / vacances), modifiables ensuite.
        </p>
        {error && <p className="text-sm text-destructive mt-2">{error}</p>}
      </CardContent>
    </Card>
  );
}
