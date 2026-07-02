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

/** Reasons a booking needs the operator's attention. */
function attentionReasons(b: AdminBooking): string[] {
  const out: string[] = [];
  if (b.paymentFlag) out.push(PAYMENT_FLAG_LABEL[b.paymentFlag] ?? b.paymentFlag);
  if (b.balanceOverdue) out.push("Solde en retard");
  if (b.balanceAttempts > 0 && b.status !== "cancelled")
    out.push(`Échec prélèvement solde ×${b.balanceAttempts}`);
  if (b.cautionAttempts > 0 && b.status !== "cancelled")
    out.push(`Échec caution ×${b.cautionAttempts}`);
  return out;
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

  const available = weeks.filter((w) => w.status === "available").length;
  const booked = weeks.filter((w) => w.status === "booked").length;
  // Real reservations = confirmed or settled (exclude carts, expired, cancelled).
  const active = bookings.filter(
    (b) => b.status === "confirmed" || b.status === "balance_paid",
  );
  const pipeline = active.reduce((acc, b) => acc + b.totalCents, 0);

  const stats = [
    { label: "Réservations", value: loading ? "…" : String(active.length) },
    { label: "Valeur des réservations", value: loading ? "…" : fmtEur(pipeline) },
    { label: "Semaines disponibles", value: loading ? "…" : String(available) },
    { label: "Semaines réservées", value: loading ? "…" : String(booked) },
  ];

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
                Rien à traiter — aucun incident de paiement en cours.
              </p>
            ) : (
              <ul className="space-y-2">
                {attention.map(({ b, reasons }) => (
                  <li
                    key={b.reference}
                    className="flex items-center justify-between gap-3 rounded-md border p-3"
                  >
                    <div>
                      <div className="text-sm font-medium">
                        {b.customerName ?? b.customerEmail ?? b.reference}
                        <span className="ml-2 text-xs text-muted-foreground">
                          {b.reference} · {b.weekRange}
                        </span>
                      </div>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {reasons.map((r) => (
                          <Badge key={r} variant="destructive">
                            {r}
                          </Badge>
                        ))}
                      </div>
                    </div>
                    <Link
                      href="/admin/reservations"
                      className="text-sm text-primary underline underline-offset-2 whitespace-nowrap"
                    >
                      Traiter
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
