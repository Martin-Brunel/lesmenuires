"use client";

import { useEffect, useMemo, useState } from "react";
import { adminApi, fmtEur, type FinancesResponse } from "@/lib/admin-api";
import { csvDate, csvEur, downloadCsv } from "@/lib/csv";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const frDate = (iso: string) =>
  new Date(iso + "T12:00:00").toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

export default function FinancesPage() {
  const [data, setData] = useState<FinancesResponse | null>(null);
  const [error, setError] = useState(false);
  const [year, setYear] = useState<string>("all");

  useEffect(() => {
    adminApi.finances().then(setData).catch(() => setError(true));
  }, []);

  const years = useMemo(() => {
    const ys = new Set((data?.taxDeclaration ?? []).map((r) => r.startDate.slice(0, 4)));
    return Array.from(ys).sort().reverse();
  }, [data]);

  const rows = useMemo(() => {
    const all = data?.taxDeclaration ?? [];
    return year === "all" ? all : all.filter((r) => r.startDate.startsWith(year));
  }, [data, year]);

  const taxTotal = rows.reduce((a, r) => a + r.touristTaxCents, 0);
  const taxCollected = rows.filter((r) => r.collected).reduce((a, r) => a + r.touristTaxCents, 0);

  if (error) {
    return <p className="text-sm text-destructive">Impossible de charger les finances.</p>;
  }
  if (!data) {
    return <p className="text-sm text-muted-foreground">Chargement…</p>;
  }

  const s = data.summary;
  const kpis = [
    { label: "Encaissé net", value: fmtEur(s.netCollectedCents), hint: "Acomptes + soldes + cautions débitées − remboursements" },
    { label: "Acomptes réglés", value: fmtEur(s.depositsPaidCents) },
    { label: "Soldes réglés", value: fmtEur(s.balancesPaidCents) },
    { label: "Remboursements", value: s.refundsCents ? `− ${fmtEur(s.refundsCents)}` : fmtEur(0) },
    { label: "Soldes à venir", value: fmtEur(s.upcomingBalancesCents), hint: `${s.upcomingCount} réservation(s) confirmée(s) non soldée(s)` },
    { label: "Cautions débitées (dégâts)", value: fmtEur(s.cautionCapturedCents), hint: "Débits sur carte enregistrée en cas de dégâts" },
    { label: "Taxe de séjour collectée", value: fmtEur(s.touristTaxCollectedCents), hint: "À reverser à la commune" },
    { label: "Taxe de séjour à venir", value: fmtEur(s.touristTaxUpcomingCents), hint: "Portée par les soldes non prélevés" },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Finances</h1>
        <p className="text-sm text-muted-foreground">
          Flux consolidés et à venir, et récapitulatif de la taxe de séjour pour déclaration.
        </p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {kpis.map((k) => (
          <Card key={k.label}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {k.label}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-semibold">{k.value}</div>
              {k.hint && <p className="mt-1 text-xs text-muted-foreground">{k.hint}</p>}
            </CardContent>
          </Card>
        ))}
      </div>

      {data.seasons.length > 0 && (
        <div className="space-y-3">
          <div>
            <h2 className="text-lg font-semibold">Par saison</h2>
            <p className="text-sm text-muted-foreground">
              Inventaire et flux de chaque saison (dossiers actifs uniquement).
            </p>
          </div>
          <Card className="overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Saison</TableHead>
                  <TableHead className="text-right">Occupation</TableHead>
                  <TableHead className="text-right">Loyers réservés</TableHead>
                  <TableHead className="text-right">Encaissé</TableHead>
                  <TableHead className="text-right">À encaisser</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.seasons.map((s) => (
                  <TableRow key={s.name}>
                    <TableCell className="font-medium">{s.name}</TableCell>
                    <TableCell className="text-right">
                      {s.weeksBooked}/{s.weeksTotal} sem.
                      <span className="ml-1 text-muted-foreground">
                        (
                        {s.weeksSellable > 0
                          ? Math.round((s.weeksBooked / s.weeksSellable) * 100)
                          : 0}{" "}
                        %)
                      </span>
                    </TableCell>
                    <TableCell className="text-right">{fmtEur(s.revenueBookedCents)}</TableCell>
                    <TableCell className="text-right font-medium">
                      {fmtEur(s.collectedCents)}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {fmtEur(s.upcomingCents)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </div>
      )}

      <div className="space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h2 className="text-lg font-semibold">Taxe de séjour — récapitulatif déclaration</h2>
            <p className="text-sm text-muted-foreground">
              Par adulte et par nuit (mineurs exonérés). {rows.length} séjour(s) —{" "}
              collectée {fmtEur(taxCollected)} / total {fmtEur(taxTotal)}.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={year}
              onChange={(e) => setYear(e.target.value)}
              className="h-9 rounded-md border bg-background px-3 text-sm"
            >
              <option value="all">Toutes les années</option>
              {years.map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
            <Button
              variant="secondary"
              disabled={rows.length === 0}
              onClick={() =>
                downloadCsv(
                  year === "all" ? "taxe-de-sejour.csv" : `taxe-de-sejour-${year}.csv`,
                  ["Référence", "Client", "Arrivée", "Adultes", "Nuits", "Taxe (€)", "Statut"],
                  rows.map((r) => [
                    r.reference,
                    r.customerName ?? "",
                    csvDate(r.startDate),
                    r.adults,
                    r.nights,
                    csvEur(r.touristTaxCents),
                    r.collected ? "Collectée" : "À venir",
                  ]),
                )
              }
            >
              Exporter CSV
            </Button>
          </div>
        </div>

        <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Référence</TableHead>
              <TableHead>Client</TableHead>
              <TableHead>Arrivée</TableHead>
              <TableHead className="text-right">Adultes</TableHead>
              <TableHead className="text-right">Nuits</TableHead>
              <TableHead className="text-right">Taxe</TableHead>
              <TableHead>Statut</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-sm text-muted-foreground">
                  Aucune taxe de séjour sur cette période.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r) => (
                <TableRow key={r.reference}>
                  <TableCell className="font-medium">{r.reference}</TableCell>
                  <TableCell>{r.customerName ?? "—"}</TableCell>
                  <TableCell>{frDate(r.startDate)}</TableCell>
                  <TableCell className="text-right">{r.adults}</TableCell>
                  <TableCell className="text-right">{r.nights}</TableCell>
                  <TableCell className="text-right">{fmtEur(r.touristTaxCents)}</TableCell>
                  <TableCell>
                    {r.collected ? (
                      <Badge variant="success">Collectée</Badge>
                    ) : (
                      <Badge variant="muted">À venir</Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
        </Card>
      </div>
    </div>
  );
}
