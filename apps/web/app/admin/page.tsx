"use client";

import { useEffect, useState } from "react";
import {
  adminApi,
  fmtEur,
  type AdminBooking,
  type AdminWeek,
} from "@/lib/admin-api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const SLUG = "ladret";

export default function DashboardPage() {
  const [weeks, setWeeks] = useState<AdminWeek[]>([]);
  const [bookings, setBookings] = useState<AdminBooking[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([adminApi.listWeeks(SLUG), adminApi.listBookings()])
      .then(([w, b]) => {
        setWeeks(w);
        setBookings(b);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const available = weeks.filter((w) => w.status === "available").length;
  const booked = weeks.filter((w) => w.status === "booked").length;
  const pipeline = bookings.reduce((acc, b) => acc + b.totalCents, 0);

  const stats = [
    { label: "Réservations", value: loading ? "…" : String(bookings.length) },
    { label: "Valeur cumulée", value: loading ? "…" : fmtEur(pipeline) },
    { label: "Semaines disponibles", value: loading ? "…" : String(available) },
    { label: "Semaines complètes", value: loading ? "…" : String(booked) },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Tableau de bord</h1>
        <p className="text-sm text-muted-foreground">Vue d&apos;ensemble de la location.</p>
      </div>
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
    </div>
  );
}
