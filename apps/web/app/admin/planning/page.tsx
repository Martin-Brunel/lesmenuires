"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { adminApi, fmtEur, type AdminSeason, type AdminWeek } from "@/lib/admin-api";
import { todayIso } from "@/lib/dates";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const SLUG = "ladret";

const STATUS_STYLE: Record<string, string> = {
  available: "border-emerald-300 bg-emerald-50 hover:bg-emerald-100",
  booked: "border-amber-300 bg-amber-50 hover:bg-amber-100",
  blocked: "border-rose-300 bg-rose-50",
};

/** "2026-12-26" -> "26 déc." (day + short month, no year). */
const dayMonth = (iso: string) =>
  new Date(iso + "T12:00:00").toLocaleDateString("fr-FR", { day: "numeric", month: "short" });

/** Month bucket key/label for a week, from its start date. */
const monthLabel = (iso: string) =>
  new Date(iso + "T12:00:00").toLocaleDateString("fr-FR", { month: "long", year: "numeric" });

function WeekChip({ week, today }: { week: AdminWeek; today: string }) {
  const past = week.endDate <= today;
  const current = week.startDate <= today && today < week.endDate;
  const body = (
    <div
      className={cn(
        "w-40 shrink-0 rounded-md border p-2 text-xs transition-colors",
        STATUS_STYLE[week.status] ?? "border-border bg-muted",
        past && "opacity-50",
        current && "ring-2 ring-primary ring-offset-1",
      )}
    >
      <div className="font-medium text-foreground whitespace-nowrap">
        {dayMonth(week.startDate)} → {dayMonth(week.endDate)}
      </div>
      <div className="mt-0.5 flex items-center justify-between gap-1 text-muted-foreground">
        <span className="truncate">
          {week.status === "booked"
            ? (week.bookingCustomer ?? week.bookingReference ?? "Réservé")
            : week.status === "blocked"
              ? "Bloqué"
              : (week.subLabel || "Disponible")}
        </span>
        <span className="whitespace-nowrap">{fmtEur(week.priceCents)}</span>
      </div>
    </div>
  );
  return week.status === "booked" && week.bookingReference ? (
    <Link href={`/admin/reservations/${week.bookingReference}`} title="Ouvrir le dossier">
      {body}
    </Link>
  ) : (
    <Link
      href={`/admin/disponibilites${week.seasonId ? `?season=${week.seasonId}` : ""}`}
      title="Modifier dans Dispos & tarifs"
    >
      {body}
    </Link>
  );
}

export default function PlanningPage() {
  const [seasons, setSeasons] = useState<AdminSeason[] | null>(null);
  const [seasonId, setSeasonId] = useState("");
  const [weeks, setWeeks] = useState<AdminWeek[] | null>(null);
  const [error, setError] = useState(false);
  const today = todayIso();

  // Seasons in chronological order so prev/next arrows follow the calendar.
  useEffect(() => {
    adminApi
      .listSeasons(SLUG)
      .then((ss) => {
        const sorted = [...ss].sort((a, b) => a.startDate.localeCompare(b.startDate));
        setSeasons(sorted);
        // Saison demandée dans l'URL (lien contextuel), sinon la saison active.
        const wanted = new URLSearchParams(window.location.search).get("season");
        setSeasonId(
          sorted.find((s) => s.id === wanted)?.id ??
            sorted.find((s) => s.isActive)?.id ??
            sorted[sorted.length - 1]?.id ??
            "",
        );
      })
      .catch(() => setError(true));
  }, []);

  useEffect(() => {
    if (!seasonId) {
      setWeeks([]);
      return;
    }
    setWeeks(null);
    adminApi
      .listWeeks(SLUG, seasonId)
      .then(setWeeks)
      .catch(() => setError(true));
  }, [seasonId]);

  const idx = (seasons ?? []).findIndex((s) => s.id === seasonId);
  const prev = idx > 0 ? seasons![idx - 1] : null;
  const next = idx >= 0 && idx < (seasons?.length ?? 0) - 1 ? seasons![idx + 1] : null;

  // Weeks in chronological order, bucketed by calendar month of arrival.
  const months = useMemo(() => {
    const out: { label: string; weeks: AdminWeek[] }[] = [];
    for (const w of weeks ?? []) {
      const label = monthLabel(w.startDate);
      const last = out[out.length - 1];
      if (last && last.label === label) last.weeks.push(w);
      else out.push({ label, weeks: [w] });
    }
    return out;
  }, [weeks]);

  const stats = useMemo(() => {
    const ws = weeks ?? [];
    const booked = ws.filter((w) => w.status === "booked");
    const sellable = ws.filter((w) => w.status !== "blocked").length;
    return {
      weeks: ws.length,
      booked: booked.length,
      occupancy: sellable > 0 ? Math.round((booked.length / sellable) * 100) : null,
      revenueCents: booked.reduce((acc, w) => acc + w.priceCents, 0),
    };
  }, [weeks]);

  if (error) {
    return <p className="text-sm text-destructive">Impossible de charger le planning.</p>;
  }
  if (seasons === null) {
    return <p className="text-sm text-muted-foreground">Chargement…</p>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Planning</h1>
          <p className="text-sm text-muted-foreground">
            La saison en un coup d&apos;œil. Cliquez sur une semaine réservée pour ouvrir le
            dossier, sur une autre pour la modifier.
          </p>
        </div>
        <div className="flex items-center gap-1">
          <Button
            size="icon"
            variant="ghost"
            className="h-9 w-9"
            disabled={!prev}
            onClick={() => prev && setSeasonId(prev.id)}
            title={prev ? prev.name : "Pas de saison précédente"}
          >
            <ChevronLeft className="size-4" />
          </Button>
          <select
            aria-label="Saison affichée"
            value={seasonId}
            onChange={(e) => setSeasonId(e.target.value)}
            className="h-9 min-w-[220px] rounded-md border border-input bg-background px-2 text-sm"
          >
            {seasons.length === 0 && <option value="">—</option>}
            {seasons.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {s.isActive ? " — active" : ""}
              </option>
            ))}
          </select>
          <Button
            size="icon"
            variant="ghost"
            className="h-9 w-9"
            disabled={!next}
            onClick={() => next && setSeasonId(next.id)}
            title={next ? next.name : "Pas de saison suivante"}
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </div>

      {seasons.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Aucune saison. Créez-en une dans « Saisons ».
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Taux d&apos;occupation
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-semibold">
                  {stats.occupancy == null ? "—" : `${stats.occupancy} %`}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Semaines réservées
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-semibold">
                  {stats.booked}
                  <span className="ml-1 text-sm font-normal text-muted-foreground">
                    / {stats.weeks}
                  </span>
                </div>
              </CardContent>
            </Card>
            <Card className="col-span-2">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Loyers réservés sur la saison
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-semibold">{fmtEur(stats.revenueCents)}</div>
              </CardContent>
            </Card>
          </div>

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
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full ring-2 ring-primary ring-offset-1" />
              Semaine en cours
            </span>
          </div>

          {weeks === null ? (
            <p className="text-sm text-muted-foreground">Chargement…</p>
          ) : months.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Aucune semaine sur cette saison. Générez-les dans « Dispos &amp; tarifs ».
            </p>
          ) : (
            <div className="space-y-4">
              {months.map((m) => (
                <div key={m.label} className="flex items-start gap-3">
                  <div className="w-28 shrink-0 pt-2 text-sm font-medium capitalize">
                    {m.label}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {m.weeks.map((w) => (
                      <WeekChip key={w.id} week={w} today={today} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
