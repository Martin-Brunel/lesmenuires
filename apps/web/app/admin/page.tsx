"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  adminApi,
  fmtEur,
  type AdminBooking,
  type AdminWeek,
} from "@/lib/admin-api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PAYMENT_FLAG_LABEL } from "@/lib/admin-api";

const SLUG = "ladret";

/** Local-midnight date from an ISO "YYYY-MM-DD" (avoids UTC shifting the day). */
const localDate = (iso: string) => new Date(`${iso}T00:00:00`);

const frDate = (iso: string) =>
  localDate(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });

function daysFromToday(iso: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((localDate(iso).getTime() - today.getTime()) / 86_400_000);
}

/** "Aujourd'hui" / "Demain" / "J-5" for an upcoming date. */
function countdownLabel(iso: string): string {
  const d = daysFromToday(iso);
  if (d <= 0) return "Aujourd'hui";
  if (d === 1) return "Demain";
  return `J-${d}`;
}

const isActive = (b: AdminBooking) =>
  b.status === "confirmed" || b.status === "balance_paid";

function paxLabel(b: AdminBooking): string {
  const parts = [`${b.adults} adulte${b.adults > 1 ? "s" : ""}`];
  if (b.children > 0) parts.push(`${b.children} enfant${b.children > 1 ? "s" : ""}`);
  return parts.join(" + ");
}

/** Reasons a booking needs the operator's attention. */
function attentionReasons(b: AdminBooking): string[] {
  const out: string[] = [];
  if (b.paymentFlag) out.push(PAYMENT_FLAG_LABEL[b.paymentFlag] ?? b.paymentFlag);
  if (b.balanceOverdue) out.push("Solde en retard");
  if (b.balanceAttempts > 0 && b.status !== "cancelled")
    out.push(`Échec prélèvement solde ×${b.balanceAttempts}`);
  if (b.cautionAttempts > 0 && b.status !== "cancelled")
    out.push(`Échec caution ×${b.cautionAttempts}`);
  // Stay is over but the caution was neither released nor charged: the guest is
  // waiting for their guarantee to be closed (card) or their cheque back.
  if (
    isActive(b) &&
    b.cautionCents > 0 &&
    daysFromToday(b.endDate) <= 0 &&
    !b.cautionReleasedAt &&
    b.cautionCapturedCents == null
  ) {
    out.push(b.cautionMethod === "cheque" ? "Chèque de caution à rendre" : "Caution à clôturer");
  }
  return out;
}

/** Payment / paperwork readiness badges for an upcoming stay. */
function readinessBadges(b: AdminBooking) {
  const out: { label: string; variant: "success" | "warning" | "destructive" | "muted" }[] = [];
  if (b.balancePaidAt || b.balanceCents === 0) {
    out.push({ label: "Solde réglé", variant: "success" });
  } else if (b.balanceOverdue || b.balanceAttempts > 0) {
    out.push({ label: "Solde en incident", variant: "destructive" });
  } else if (b.channel === "manual") {
    out.push({ label: "Solde à pointer", variant: "warning" });
  } else {
    const due = new Date(localDate(b.startDate).getTime() - 14 * 86_400_000);
    out.push({
      label: `Solde le ${due.toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}`,
      variant: "muted",
    });
  }
  if (b.contractSignedAt) out.push({ label: "Contrat signé", variant: "success" });
  else if (b.channel === "web") out.push({ label: "Contrat non signé", variant: "warning" });
  if (b.cautionCents > 0)
    out.push({
      label: b.cautionMethod === "cheque" ? "Caution chèque" : "Caution carte",
      variant: "muted",
    });
  return out;
}

function BookingRow({
  b,
  right,
  badges,
}: {
  b: AdminBooking;
  right: React.ReactNode;
  badges: { label: string; variant: "success" | "warning" | "destructive" | "muted" }[];
}) {
  return (
    <li className="flex items-center justify-between gap-3 rounded-md border p-3">
      <div className="min-w-0">
        <div className="text-sm font-medium">
          <Link
            href={`/admin/reservations/${b.reference}`}
            className="text-primary underline underline-offset-2 hover:text-foreground"
          >
            {b.customerName ?? b.customerEmail ?? b.reference}
          </Link>
          <span className="ml-2 text-xs text-muted-foreground">
            {b.weekRange} · {paxLabel(b)}
            {b.customerPhone ? ` · ${b.customerPhone}` : ""}
          </span>
        </div>
        <div className="mt-1 flex flex-wrap gap-1">
          {badges.map((x) => (
            <Badge key={x.label} variant={x.variant}>
              {x.label}
            </Badge>
          ))}
        </div>
      </div>
      <div className="shrink-0 text-right text-sm font-medium whitespace-nowrap">{right}</div>
    </li>
  );
}

export default function DashboardPage() {
  const [weeks, setWeeks] = useState<AdminWeek[]>([]);
  const [bookings, setBookings] = useState<AdminBooking[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    Promise.all([adminApi.listWeeks(SLUG), adminApi.listBookings()])
      .then(([w, b]) => {
        setWeeks(w);
        setBookings(b);
      })
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
  }, []);

  // KPIs scopés sur l'activité réelle : les saisons passées ne comptent pas.
  const futureWeeks = weeks.filter((w) => daysFromToday(w.startDate) > 0);
  const available = futureWeeks.filter((w) => w.status === "available").length;
  const booked = futureWeeks.filter((w) => w.status === "booked").length;
  const sellable = available + booked;
  const occupancy = sellable > 0 ? Math.round((booked / sellable) * 100) : null;
  // Real reservations = confirmed or settled (exclude carts, expired, cancelled),
  // and still ahead of us (stay in progress or upcoming).
  const active = bookings.filter(isActive).filter((b) => daysFromToday(b.endDate) > 0);
  const pipeline = active.reduce((acc, b) => acc + b.totalCents, 0);

  const stats = [
    { label: "Séjours à venir ou en cours", value: loading ? "…" : String(active.length) },
    { label: "Valeur de ces séjours", value: loading ? "…" : fmtEur(pipeline) },
    {
      label: "Occupation des semaines à venir",
      value: loading ? "…" : occupancy == null ? "—" : `${occupancy} %`,
    },
    { label: "Semaines encore disponibles", value: loading ? "…" : String(available) },
  ];

  const inProgress = active.filter((b) => daysFromToday(b.startDate) <= 0);
  const upcoming = active
    .filter((b) => daysFromToday(b.startDate) > 0)
    .sort((a, b) => a.startDate.localeCompare(b.startDate))
    .slice(0, 6);

  const attention = bookings
    .map((b) => ({ b, reasons: attentionReasons(b) }))
    .filter((x) => x.reasons.length > 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Tableau de bord</h1>
        <p className="text-sm text-muted-foreground">Vue d&apos;ensemble de la location.</p>
      </div>
      {loadError && (
        <p className="text-sm text-destructive">
          Impossible de charger les données. Rechargez la page.
        </p>
      )}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((s) => (
          <Card key={s.label}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {s.label}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-semibold">{s.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {!loading && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">
              Actions requises
              {attention.length > 0 && (
                <span className="ml-2 text-sm font-normal text-destructive">
                  {attention.length}
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {attention.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Rien à traiter — aucun incident en cours.
              </p>
            ) : (
              <ul className="space-y-2">
                {attention.map(({ b, reasons }) => (
                  <BookingRow
                    key={b.reference}
                    b={b}
                    badges={reasons.map((r) => ({ label: r, variant: "destructive" as const }))}
                    right={
                      <Link
                        href={`/admin/reservations/${b.reference}`}
                        className="text-sm text-primary underline underline-offset-2"
                      >
                        Traiter
                      </Link>
                    }
                  />
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      {!loading && inProgress.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Séjour en cours</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {inProgress.map((b) => (
                <BookingRow
                  key={b.reference}
                  b={b}
                  badges={readinessBadges(b)}
                  right={
                    <span className="text-muted-foreground">
                      Départ {daysFromToday(b.endDate) === 1 ? "demain" : `le ${frDate(b.endDate)}`}
                    </span>
                  }
                />
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {!loading && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center justify-between">
              Prochaines arrivées
              <Link
                href="/admin/reservations"
                className="text-xs font-normal text-primary underline underline-offset-2"
              >
                Toutes les réservations
              </Link>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {upcoming.length === 0 ? (
              <p className="text-sm text-muted-foreground">Aucune arrivée programmée.</p>
            ) : (
              <ul className="space-y-2">
                {upcoming.map((b) => (
                  <BookingRow
                    key={b.reference}
                    b={b}
                    badges={readinessBadges(b)}
                    right={<span>{countdownLabel(b.startDate)}</span>}
                  />
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
