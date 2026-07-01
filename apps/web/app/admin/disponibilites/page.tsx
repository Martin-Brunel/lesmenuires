"use client";

import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import {
  adminApi,
  type AdminSeason,
  type AdminWeek,
  type RateTier,
} from "@/lib/admin-api";
import { frLong, frShort } from "@/lib/dates";
import { useConfirm } from "@/components/admin/dialogs";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DateField } from "@/components/admin/DateField";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const SLUG = "ladret";
const STATUS_LABEL: Record<string, string> = {
  available: "Disponible",
  booked: "Réservé",
  blocked: "Bloqué",
};
const selectBase =
  "w-full rounded-md border border-input bg-background text-foreground px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

type Draft = { tierKey: string; euros: string; status: string; sub: string };

const initDraft = (w: AdminWeek): Draft => ({
  tierKey: w.tierKey ?? "",
  euros: (w.priceCents / 100).toString(),
  status: w.status,
  sub: w.subLabel,
});

const isDirty = (w: AdminWeek, d: Draft | undefined) =>
  !!d &&
  (d.tierKey !== (w.tierKey ?? "") ||
    Math.round(parseFloat(d.euros || "0") * 100) !== w.priceCents ||
    d.status !== w.status ||
    d.sub !== w.subLabel);

export default function DisponibilitesPage() {
  const confirm = useConfirm();
  const [weeks, setWeeks] = useState<AdminWeek[] | null>(null);
  const [seasons, setSeasons] = useState<AdminSeason[]>([]);
  const [seasonId, setSeasonId] = useState("");
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [saveErr, setSaveErr] = useState(false);

  const load = (sid: string) => {
    if (!sid) {
      setWeeks([]);
      setDrafts({});
      return;
    }
    adminApi
      .listWeeks(SLUG, sid)
      .then((ws) => {
        setWeeks(ws);
        setDrafts(Object.fromEntries(ws.map((w) => [w.id, initDraft(w)])));
      })
      .catch(() => setWeeks([]));
  };

  useEffect(() => {
    adminApi
      .listSeasons(SLUG)
      .then((ss) => {
        setSeasons(ss);
        setSeasonId(ss.find((s) => s.isActive)?.id ?? ss[0]?.id ?? "");
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    load(seasonId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seasonId]);

  const reload = () => load(seasonId);
  const tiers = seasons.find((s) => s.id === seasonId)?.rateTiers ?? [];

  const setDraft = (id: string, patch: Partial<Draft>) =>
    setDrafts((d) => ({ ...d, [id]: { ...d[id], ...patch } }));

  const dirtyWeeks = (weeks ?? []).filter((w) => isDirty(w, drafts[w.id]));

  const saveAll = async () => {
    setSaving(true);
    setSaveMsg(null);
    setSaveErr(false);
    try {
      await Promise.all(
        dirtyWeeks.map((w) => {
          const d = drafts[w.id];
          return adminApi.updateWeek(w.id, {
            priceCents: Math.round(parseFloat(d.euros || "0") * 100),
            status: d.status,
            subLabel: d.sub,
            tierKey: d.tierKey || undefined,
          });
        }),
      );
      setSaveMsg("Modifications enregistrées.");
      setTimeout(() => setSaveMsg(null), 2500);
      reload();
    } catch (e) {
      setSaveErr(true);
      setSaveMsg(e instanceof Error ? e.message : "Erreur");
    } finally {
      setSaving(false);
    }
  };

  const removeWeek = async (w: AdminWeek) => {
    if (
      !(await confirm({
        title: "Supprimer la semaine ?",
        description: `« ${w.rangeLabel} »`,
        danger: true,
        confirmLabel: "Supprimer",
      }))
    )
      return;
    try {
      await adminApi.deleteWeek(w.id);
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Dispos &amp; tarifs</h1>
        <p className="text-sm text-muted-foreground">
          Prix et disponibilité par semaine, pour la saison sélectionnée. Modifiez librement puis
          enregistrez d&apos;un coup.
        </p>
      </div>

      <Card>
        <div className="flex items-center justify-between gap-3 flex-wrap p-4 border-b">
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />Disponible
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />Réservé
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-rose-400" />Bloqué
            </span>
          </div>
          <select
            aria-label="Saison affichée"
            value={seasonId}
            onChange={(e) => setSeasonId(e.target.value)}
            className={cn(selectBase, "h-9 w-auto min-w-[220px]")}
          >
            {seasons.length === 0 && <option value="">—</option>}
            {seasons.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {s.isActive ? " — active" : ""}
              </option>
            ))}
          </select>
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Semaine</TableHead>
              <TableHead className="w-[170px]">Tarif</TableHead>
              <TableHead className="w-[120px]">Prix / sem.</TableHead>
              <TableHead>Mention</TableHead>
              <TableHead className="w-[120px]">Statut</TableHead>
              <TableHead className="w-[60px] text-right" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {weeks === null && (
              <TableRow>
                <TableCell colSpan={6} className="text-muted-foreground py-6 text-center">
                  Chargement…
                </TableCell>
              </TableRow>
            )}
            {weeks?.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-muted-foreground py-6 text-center">
                  Aucune semaine pour cette saison. Générez-en ci-dessous.
                </TableCell>
              </TableRow>
            )}
            {weeks?.map((w) => (
              <WeekRow
                key={w.id}
                week={w}
                draft={drafts[w.id] ?? initDraft(w)}
                tiers={tiers}
                dirty={isDirty(w, drafts[w.id])}
                onChange={(patch) => setDraft(w.id, patch)}
                onDelete={() => removeWeek(w)}
              />
            ))}
          </TableBody>
        </Table>

        {weeks && weeks.length > 0 && (
          <div className="flex items-center justify-between gap-3 p-4 border-t">
            <div className="text-sm text-muted-foreground">
              {dirtyWeeks.length === 0
                ? "Aucune modification en attente"
                : `${dirtyWeeks.length} semaine(s) modifiée(s)`}
              {saveMsg && <span className={"ml-2 " + (saveErr ? "text-destructive" : "text-emerald-600")}>{saveMsg}</span>}
            </div>
            <Button onClick={saveAll} disabled={saving || dirtyWeeks.length === 0}>
              {saving ? "Enregistrement…" : "Enregistrer les modifications"}
            </Button>
          </div>
        )}
      </Card>

      <GenerateWeeks seasons={seasons} defaultSeasonId={seasonId} onGenerated={reload} />
    </div>
  );
}

function WeekRow({
  week,
  draft,
  tiers,
  dirty,
  onChange,
  onDelete,
}: {
  week: AdminWeek;
  draft: Draft;
  tiers: RateTier[];
  dirty: boolean;
  onChange: (patch: Partial<Draft>) => void;
  onDelete: () => void;
}) {
  const statusBorder =
    draft.status === "available"
      ? "border-l-emerald-500"
      : draft.status === "booked"
        ? "border-l-amber-500"
        : "border-l-rose-400";

  const applyTier = (key: string) => {
    const t = tiers.find((x) => x.key === key);
    onChange(
      t
        ? { tierKey: key, euros: (t.priceCents / 100).toString(), sub: t.label }
        : { tierKey: key },
    );
  };

  return (
    <TableRow className={dirty ? "bg-amber-50" : undefined}>
      <TableCell className={cn("font-medium whitespace-nowrap border-l-4", statusBorder)}>
        {week.rangeLabel}
        <div className="text-xs font-normal text-muted-foreground">
          {frShort(week.startDate)} → {frShort(week.endDate)}
        </div>
      </TableCell>
      <TableCell>
        <select
          value={draft.tierKey}
          onChange={(e) => applyTier(e.target.value)}
          style={{ colorScheme: "light" }}
          className={cn(selectBase, "h-8")}
        >
          <option value="">Prix personnalisé</option>
          {tiers.map((t) => (
            <option key={t.key} value={t.key}>
              {t.label}
            </option>
          ))}
        </select>
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-1">
          <Input
            type="number"
            min={0}
            step={10}
            value={draft.euros}
            onChange={(e) => onChange({ euros: e.target.value, tierKey: "" })}
            className="h-8"
          />
          <span className="text-muted-foreground text-sm">€</span>
        </div>
      </TableCell>
      <TableCell>
        <Input value={draft.sub} onChange={(e) => onChange({ sub: e.target.value })} className="h-8" />
      </TableCell>
      <TableCell>
        <select
          value={draft.status}
          onChange={(e) => onChange({ status: e.target.value })}
          style={{ colorScheme: "light" }}
          className={cn(selectBase, "h-8")}
        >
          {Object.entries(STATUS_LABEL).map(([v, label]) => (
            <option key={v} value={v}>
              {label}
            </option>
          ))}
        </select>
      </TableCell>
      <TableCell className="text-right">
        <Button
          size="icon"
          variant="ghost"
          className="h-8 w-8"
          onClick={onDelete}
          title="Supprimer la semaine"
        >
          <Trash2 className="size-4 text-destructive" />
        </Button>
      </TableCell>
    </TableRow>
  );
}

function GenerateWeeks({
  seasons,
  defaultSeasonId,
  onGenerated,
}: {
  seasons: AdminSeason[];
  defaultSeasonId: string;
  onGenerated: () => void;
}) {
  const [seasonId, setSeasonId] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [tierKey, setTierKey] = useState("");
  const [euros, setEuros] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (defaultSeasonId) setSeasonId(defaultSeasonId);
  }, [defaultSeasonId]);

  const season = seasons.find((s) => s.id === seasonId);
  const tiers = season?.rateTiers ?? [];
  const isSat = (d: string) => d !== "" && new Date(d + "T12:00:00").getDay() === 6;
  const dateWarn = (startDate !== "" && !isSat(startDate)) || (endDate !== "" && !isSat(endDate));

  const onTier = (key: string) => {
    setTierKey(key);
    const t = tiers.find((x) => x.key === key);
    if (t) setEuros((t.priceCents / 100).toString());
  };

  const generate = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    setError(null);
    try {
      const created = await adminApi.generateWeeks({
        seasonId,
        startDate,
        endDate,
        tierKey: tierKey || undefined,
        priceCents: tierKey ? undefined : Math.round(parseFloat(euros || "0") * 100),
      });
      setMsg(
        created.length === 0
          ? "Aucune nouvelle semaine (déjà existantes)."
          : `${created.length} semaine(s) ajoutée(s).`,
      );
      onGenerated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Générer des semaines</CardTitle>
      </CardHeader>
      <CardContent>
        {seasons.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Crée d&apos;abord une saison dans l&apos;onglet « Saisons ».
          </p>
        ) : (
          <>
            <form onSubmit={generate} className="grid grid-cols-2 lg:grid-cols-5 gap-3 items-end">
              <div className="space-y-1.5">
                <Label>Saison</Label>
                <select
                  value={seasonId}
                  onChange={(e) => setSeasonId(e.target.value)}
                  className={cn(selectBase, "h-9")}
                >
                  {seasons.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label>Premier samedi</Label>
                <DateField value={startDate} onChange={setStartDate} />
                {startDate && <p className="text-xs text-muted-foreground">{frLong(startDate)}</p>}
              </div>
              <div className="space-y-1.5">
                <Label>Dernier samedi</Label>
                <DateField value={endDate} onChange={setEndDate} />
                {endDate && <p className="text-xs text-muted-foreground">{frLong(endDate)}</p>}
              </div>
              <div className="space-y-1.5">
                <Label>Tarif</Label>
                <select
                  value={tierKey}
                  onChange={(e) => onTier(e.target.value)}
                  className={cn(selectBase, "h-9")}
                >
                  <option value="">Prix personnalisé</option>
                  {tiers.map((t) => (
                    <option key={t.key} value={t.key}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label>Prix (€)</Label>
                <Input
                  type="number"
                  min={0}
                  step={10}
                  value={euros}
                  onChange={(e) => setEuros(e.target.value)}
                  disabled={tierKey !== ""}
                />
              </div>
              <Button
                type="submit"
                disabled={busy || dateWarn || !startDate || !endDate}
                className="lg:col-span-5 w-fit"
              >
                {busy ? "…" : "Générer la saison"}
              </Button>
            </form>
            <p className="text-xs text-muted-foreground mt-2">
              Crée tous les créneaux samedi → samedi du premier au dernier samedi (libellés et dates
              calculés automatiquement). Les semaines déjà existantes sont ignorées.
            </p>
            {dateWarn && (
              <p className="text-sm text-amber-600 mt-2">
                Le premier et le dernier jour doivent être des samedis.
              </p>
            )}
            {msg && <p className="text-sm text-emerald-600 mt-2">{msg}</p>}
            {error && <p className="text-sm text-destructive mt-2">{error}</p>}
          </>
        )}
      </CardContent>
    </Card>
  );
}
