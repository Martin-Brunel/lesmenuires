"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { adminApi, fmtEur, type BookingDetail } from "@/lib/admin-api";
import { site } from "@/lib/site";
import { Button } from "@/components/ui/button";

const dd = (iso: string) =>
  new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });

/** Départ = arrivée + 7 nuits (location à la semaine). */
const departure = (startIso: string) =>
  dd(new Date(new Date(startIso + "T12:00:00").getTime() + 7 * 86_400_000).toISOString());

export default function FacturePage() {
  const params = useParams<{ reference: string }>();
  const reference = params.reference;
  const [data, setData] = useState<BookingDetail | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    adminApi.bookingDetail(reference).then(setData).catch(() => setError(true));
  }, [reference]);

  if (error) return <p className="text-sm text-destructive">Dossier introuvable.</p>;
  if (!data) return <p className="text-sm text-muted-foreground">Chargement…</p>;

  const b = data.booking;
  const lines = data.lines;
  // Taxe en sus : portée par le solde, hors total locatif (acompte + solde
  // dépassent alors le total). Sinon elle est déjà incluse dans les prix.
  const taxeEnSus =
    b.touristTaxCents > 0 &&
    b.depositCents + b.balanceCents === b.totalCents + b.touristTaxCents;
  const grandTotal = b.totalCents + (taxeEnSus ? b.touristTaxCents : 0);
  const settled = b.status === "balance_paid" || (b.depositPaidAt && b.balancePaidAt);
  const paid =
    (b.depositPaidAt ? b.depositCents : 0) + (b.balancePaidAt ? b.balanceCents : 0);
  const remaining = Math.max(0, grandTotal - paid);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 print:hidden">
        <Link
          href={`/admin/reservations/${reference}`}
          className="text-sm text-primary underline underline-offset-2"
        >
          ‹ Dossier {reference}
        </Link>
        <Button onClick={() => window.print()}>Imprimer / PDF</Button>
      </div>

      <div className="mx-auto max-w-[210mm] rounded-lg border bg-white p-10 text-[13px] leading-relaxed text-neutral-900 shadow-sm print:max-w-none print:rounded-none print:border-0 print:p-0 print:shadow-none">
        {/* En-tête */}
        <div className="flex items-start justify-between border-b pb-6">
          <div>
            <div className="text-2xl" style={{ fontFamily: "'Marcellus',serif" }}>
              {site.name}
            </div>
            <div className="text-neutral-500">Location de meublé de tourisme</div>
            {b.ownerName && (
              <div className="mt-2 text-neutral-500">
                {b.ownerName}
                {b.ownerAddress ? <><br />{b.ownerAddress}</> : null}
                {b.ownerSiret ? <><br />SIRET {b.ownerSiret}</> : null}
              </div>
            )}
          </div>
          <div className="text-right">
            <div className="text-lg font-semibold">
              {settled ? "Quittance de séjour" : "Facture de séjour"}
            </div>
            <div className="text-neutral-500">
              Réservation {b.reference}
              <br />
              Émise le {new Date().toLocaleDateString("fr-FR")}
            </div>
          </div>
        </div>

        {/* Client + séjour */}
        <div className="mt-6 grid grid-cols-2 gap-6">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
              Client
            </div>
            <div className="mt-1 font-medium">{b.customerName ?? "—"}</div>
            {b.customerAddress && <div>{b.customerAddress}</div>}
            {b.customerEmail && <div>{b.customerEmail}</div>}
            {b.customerPhone && <div>{b.customerPhone}</div>}
          </div>
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
              Séjour
            </div>
            <div className="mt-1">
              Du <strong>{dd(b.startDate)}</strong> au <strong>{departure(b.startDate)}</strong>
            </div>
            <div>
              {b.adults} adulte(s)
              {b.children > 0 ? ` · ${b.children} enfant(s)` : ""} — 7 nuits
            </div>
          </div>
        </div>

        {/* Lignes */}
        <table className="mt-8 w-full border-collapse">
          <thead>
            <tr className="border-b text-left text-xs uppercase tracking-wide text-neutral-500">
              <th className="py-2 font-semibold">Désignation</th>
              <th className="py-2 text-right font-semibold">Qté</th>
              <th className="py-2 text-right font-semibold">Prix unitaire</th>
              <th className="py-2 text-right font-semibold">Montant</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i} className="border-b border-neutral-100">
                <td className="py-2">{l.label}</td>
                <td className="py-2 text-right">{l.quantity}</td>
                <td className="py-2 text-right">{fmtEur(l.unitPriceCents)}</td>
                <td className="py-2 text-right">{fmtEur(l.totalCents)}</td>
              </tr>
            ))}
            {b.touristTaxCents > 0 && taxeEnSus && (
              <tr className="border-b border-neutral-100">
                <td className="py-2">Taxe de séjour ({b.adults} adulte(s) × 7 nuits)</td>
                <td className="py-2 text-right">1</td>
                <td className="py-2 text-right">{fmtEur(b.touristTaxCents)}</td>
                <td className="py-2 text-right">{fmtEur(b.touristTaxCents)}</td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={3} className="py-3 text-right font-semibold">
                Total
              </td>
              <td className="py-3 text-right text-base font-semibold">{fmtEur(grandTotal)}</td>
            </tr>
            {b.touristTaxCents > 0 && !taxeEnSus && (
              <tr>
                <td colSpan={3} className="text-right text-neutral-500">
                  dont taxe de séjour
                </td>
                <td className="text-right text-neutral-500">{fmtEur(b.touristTaxCents)}</td>
              </tr>
            )}
          </tfoot>
        </table>

        {/* Règlements */}
        <div className="mt-8">
          <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
            Règlements
          </div>
          <table className="mt-1 w-full">
            <tbody>
              <tr>
                <td className="py-1">Acompte ({b.depositPct} %)</td>
                <td className="py-1 text-right">{fmtEur(b.depositCents)}</td>
                <td className="py-1 pl-6 text-neutral-500">
                  {b.depositPaidAt ? `réglé le ${dd(b.depositPaidAt)}` : "à régler"}
                </td>
              </tr>
              <tr>
                <td className="py-1">Solde</td>
                <td className="py-1 text-right">{fmtEur(b.balanceCents)}</td>
                <td className="py-1 pl-6 text-neutral-500">
                  {b.balancePaidAt ? `réglé le ${dd(b.balancePaidAt)}` : "à régler"}
                </td>
              </tr>
              {remaining > 0 && (
                <tr className="font-semibold">
                  <td className="py-1">Reste dû</td>
                  <td className="py-1 text-right">{fmtEur(remaining)}</td>
                  <td />
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {settled && (
          <p className="mt-6 font-medium">
            Le propriétaire reconnaît avoir reçu le paiement intégral du séjour, soit{" "}
            {fmtEur(grandTotal)}, et en donne quittance.
          </p>
        )}

        {b.cautionCents > 0 && (
          <p className="mt-4 text-neutral-500">
            Dépôt de garantie : {fmtEur(b.cautionCents)}{" "}
            {b.cautionMethod === "cheque"
              ? "(chèque non encaissé, restitué après l'état des lieux)"
              : "(carte enregistrée, débitée uniquement en cas de dégâts)"}
            . Il ne constitue pas un revenu et n&apos;apparaît pas au total.
          </p>
        )}

        <p className="mt-8 border-t pt-4 text-xs text-neutral-400">
          Document établi par le propriétaire pour la réservation {b.reference}. Location
          meublée de tourisme — taxe de séjour reversée à la commune.
        </p>
      </div>
    </div>
  );
}
