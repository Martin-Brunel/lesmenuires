"use client";

import { useCallback, useEffect, useState } from "react";
import {
  adminApi,
  fmtEur,
  type ReportLine,
  type ReportMeta,
  type SeasonReport,
  type YearReport,
} from "@/lib/admin-api";
import { csvEur, downloadCsv } from "@/lib/csv";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "@/components/ui/toast";
import { HelpCard } from "@/components/admin/HelpCard";
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

type Mode = { kind: "year"; year: number } | { kind: "season"; seasonId: string };

export default function BilansPage() {
  const [meta, setMeta] = useState<ReportMeta | null>(null);
  const [mode, setMode] = useState<Mode | null>(null);
  const [yearReport, setYearReport] = useState<YearReport | null>(null);
  const [seasonReport, setSeasonReport] = useState<SeasonReport | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    adminApi
      .reportMeta()
      .then((m) => {
        setMeta(m);
        if (m.years.length > 0) setMode({ kind: "year", year: m.years[0] });
      })
      .catch(() => setError(true));
  }, []);

  const load = useCallback((m: Mode) => {
    setYearReport(null);
    setSeasonReport(null);
    if (m.kind === "year") {
      adminApi
        .yearReport(m.year)
        .then(setYearReport)
        .catch((e) => toast.error(e instanceof Error ? e.message : "Erreur"));
    } else {
      adminApi
        .seasonReport(m.seasonId)
        .then(setSeasonReport)
        .catch((e) => toast.error(e instanceof Error ? e.message : "Erreur"));
    }
  }, []);

  useEffect(() => {
    if (mode) load(mode);
  }, [mode, load]);

  if (error) {
    return <p className="text-sm text-destructive">Impossible de charger les bilans.</p>;
  }
  if (!meta || !mode) {
    return <p className="text-sm text-muted-foreground">Chargement…</p>;
  }

  const selectValue = mode.kind === "year" ? `y:${mode.year}` : `s:${mode.seasonId}`;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Bilans</h1>
          <p className="text-sm text-muted-foreground">
            Synthèse d&apos;un exercice annuel ou d&apos;une saison : revenus, dépenses,
            résultat.
          </p>
        </div>
        <select
          value={selectValue}
          onChange={(e) => {
            const v = e.target.value;
            setMode(
              v.startsWith("y:")
                ? { kind: "year", year: Number(v.slice(2)) }
                : { kind: "season", seasonId: v.slice(2) },
            );
          }}
          className="h-9 rounded-md border bg-background px-3 text-sm"
        >
          <optgroup label="Exercices annuels">
            {meta.years.map((y) => (
              <option key={y} value={`y:${y}`}>
                Exercice {y}
              </option>
            ))}
          </optgroup>
          {meta.seasons.length > 0 && (
            <optgroup label="Saisons">
              {meta.seasons.map((s) => (
                <option key={s.id} value={`s:${s.id}`}>
                  {s.name}
                </option>
              ))}
            </optgroup>
          )}
        </select>
      </div>

      <HelpCard id="bilans">
        <p>
          Deux lectures complémentaires : l&apos;<b>exercice annuel</b> (année civile, la vue
          de la déclaration fiscale) et la <b>saison</b> (la vue « est-ce que cet hiver a été
          rentable ? »).
        </p>
        <ul className="list-disc pl-5 space-y-1">
          <li>
            <b>Compte de résultat</b> : les revenus (loyers, prestations) moins les dépenses
            (électricité, copropriété, assurance…). C&apos;est la rentabilité de la période —
            pas le solde en banque.
          </li>
          <li>
            <b>Bilan simplifié</b> (vue annuelle) : la photo au 31 décembre — ce que
            l&apos;activité possède (banque, créances clients) et ce qu&apos;elle doit
            (fournisseurs, taxe à reverser).
          </li>
          <li>
            Pour une <b>saison</b>, les revenus sont ceux des réservations de la saison, même
            encaissés des mois avant ; les dépenses sont celles datées pendant la saison.
          </li>
        </ul>
      </HelpCard>

      {mode.kind === "year" && !yearReport && (
        <p className="text-sm text-muted-foreground">Chargement du bilan…</p>
      )}
      {mode.kind === "season" && !seasonReport && (
        <p className="text-sm text-muted-foreground">Chargement du bilan…</p>
      )}

      {yearReport && <YearView r={yearReport} />}
      {seasonReport && <SeasonView r={seasonReport} />}
    </div>
  );
}

function Kpi({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "good" | "bad" }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <div
          className={`text-2xl font-semibold ${
            tone === "good" ? "text-emerald-600" : tone === "bad" ? "text-destructive" : ""
          }`}
        >
          {value}
        </div>
        {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}

/** Tableau produits ou charges avec total. */
function ResultTable({
  title,
  lines,
  totalCents,
  emptyText,
}: {
  title: string;
  lines: ReportLine[];
  totalCents: number;
  emptyText: string;
}) {
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold">{title}</h3>
      <Card className="overflow-hidden">
        <Table>
          <TableBody>
            {lines.length === 0 ? (
              <TableRow>
                <TableCell className="text-sm text-muted-foreground">{emptyText}</TableCell>
              </TableRow>
            ) : (
              <>
                {lines.map((l) => (
                  <TableRow key={l.code}>
                    <TableCell>
                      <span className="font-mono text-xs text-muted-foreground mr-2">
                        {l.code}
                      </span>
                      {l.name}
                    </TableCell>
                    <TableCell className="text-right font-medium">{fmtEur(l.cents)}</TableCell>
                  </TableRow>
                ))}
                <TableRow className="bg-muted/40">
                  <TableCell className="font-semibold">Total</TableCell>
                  <TableCell className="text-right font-semibold">{fmtEur(totalCents)}</TableCell>
                </TableRow>
              </>
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}

function exportResultCsv(label: string, produits: ReportLine[], charges: ReportLine[], resultat: number) {
  downloadCsv(
    `bilan-${label.toLowerCase().replace(/\s+/g, "-")}.csv`,
    ["Type", "Compte", "Libellé", "Montant (€)"],
    [
      ...produits.map((l) => ["Produit", l.code, l.name, csvEur(l.cents)]),
      ...charges.map((l) => ["Charge", l.code, l.name, csvEur(l.cents)]),
      ["Résultat", "", "", csvEur(resultat)],
    ],
  );
}

function YearView({ r }: { r: YearReport }) {
  return (
    <div className="space-y-8">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Kpi label="Revenus" value={fmtEur(r.totalProduitsCents)} hint="Loyers, prestations, cautions retenues" />
        <Kpi label="Dépenses" value={fmtEur(r.totalChargesCents)} hint="Charges de l'année" />
        <Kpi
          label="Résultat"
          value={fmtEur(r.resultatCents)}
          hint="Revenus − dépenses"
          tone={r.resultatCents >= 0 ? "good" : "bad"}
        />
        <Kpi
          label="Trésorerie de l'année"
          value={`${fmtEur(r.inCents)} / − ${fmtEur(r.outCents)}`}
          hint="Entré / sorti des comptes (hors virements internes)"
        />
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h2 className="text-lg font-semibold">Compte de résultat — {r.label}</h2>
            <p className="text-sm text-muted-foreground">
              Du {frDate(r.from)} au {frDate(r.to)}.
            </p>
          </div>
          <Button
            variant="secondary"
            onClick={() => exportResultCsv(r.label, r.produits, r.charges, r.resultatCents)}
          >
            Exporter CSV
          </Button>
        </div>
        <div className="grid lg:grid-cols-2 gap-6">
          <ResultTable
            title="Revenus (produits)"
            lines={r.produits}
            totalCents={r.totalProduitsCents}
            emptyText="Aucun revenu sur la période."
          />
          <ResultTable
            title="Dépenses (charges)"
            lines={r.charges}
            totalCents={r.totalChargesCents}
            emptyText="Aucune dépense sur la période."
          />
        </div>
      </div>

      <div className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold">Bilan simplifié au {frDate(r.to)}</h2>
          <p className="text-sm text-muted-foreground">
            La photo du patrimoine de l&apos;activité : à gauche ce qu&apos;elle possède, à
            droite ce qu&apos;elle doit (les deux colonnes s&apos;équilibrent).
          </p>
        </div>
        <div className="grid lg:grid-cols-2 gap-6">
          <ResultTable
            title="Actif (ce que l'activité possède)"
            lines={r.actif}
            totalCents={r.totalActifCents}
            emptyText="Rien à l'actif."
          />
          <ResultTable
            title="Passif (ce que l'activité doit, et le résultat)"
            lines={r.passif}
            totalCents={r.totalPassifCents}
            emptyText="Rien au passif."
          />
        </div>
        {r.totalActifCents !== r.totalPassifCents && (
          <p className="text-xs text-destructive">
            Actif et passif diffèrent — des écritures sont probablement en attente de
            synchronisation.
          </p>
        )}
      </div>
    </div>
  );
}

function SeasonView({ r }: { r: SeasonReport }) {
  const occupancy = r.weeksTotal > 0 ? Math.round((r.weeksBooked / r.weeksTotal) * 100) : 0;
  return (
    <div className="space-y-8">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Kpi
          label="Occupation"
          value={`${r.weeksBooked}/${r.weeksTotal} sem.`}
          hint={`${occupancy} % — ${fmtEur(r.revenueBookedCents)} de loyers réservés`}
        />
        <Kpi label="Revenus de la saison" value={fmtEur(r.totalProduitsCents)} hint="Rattachés aux réservations de la saison" />
        <Kpi label="Dépenses de la période" value={fmtEur(r.totalChargesCents)} hint={`Du ${frDate(r.from)} au ${frDate(r.to)}`} />
        <Kpi
          label="Résultat de saison"
          value={fmtEur(r.resultatCents)}
          hint="Revenus − dépenses"
          tone={r.resultatCents >= 0 ? "good" : "bad"}
        />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Kpi label="Encaissé (net)" value={fmtEur(r.collectedCents)} hint="Arrivé en trésorerie sur les dossiers de la saison" />
        <Kpi label="Taxe de séjour" value={fmtEur(r.taxCents)} hint="Collectée pour la commune (à reverser)" />
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h2 className="text-lg font-semibold">Compte de résultat — {r.label}</h2>
            <p className="text-sm text-muted-foreground">
              Revenus des réservations de la saison ; dépenses datées du {frDate(r.from)} au{" "}
              {frDate(r.to)}.
            </p>
          </div>
          <Button
            variant="secondary"
            onClick={() => exportResultCsv(r.label, r.produits, r.charges, r.resultatCents)}
          >
            Exporter CSV
          </Button>
        </div>
        <div className="grid lg:grid-cols-2 gap-6">
          <ResultTable
            title="Revenus (produits)"
            lines={r.produits}
            totalCents={r.totalProduitsCents}
            emptyText="Aucun revenu rattaché à cette saison."
          />
          <ResultTable
            title="Dépenses (charges)"
            lines={r.charges}
            totalCents={r.totalChargesCents}
            emptyText="Aucune dépense sur la période de la saison."
          />
        </div>
      </div>
    </div>
  );
}
