"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { adminApi, fmtEur, type SalesInvoice } from "@/lib/admin-api";
import { Button } from "@/components/ui/button";

const dd = (iso: string) =>
  new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });

const departure = (startIso: string, nights: number) =>
  dd(new Date(new Date(startIso + "T12:00:00").getTime() + nights * 86_400_000).toISOString());

export default function FacturePage() {
  const { reference } = useParams<{ reference: string }>();
  const [invoice, setInvoice] = useState<SalesInvoice | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    adminApi
      .issueInvoice(reference)
      .then(setInvoice)
      .catch((e) => setError(e instanceof Error ? e.message : "Facture indisponible."));
  }, [reference]);

  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!invoice) return <p className="text-sm text-muted-foreground">Émission de la facture…</p>;

  const { seller, customer, stay, payment, lines } = invoice;
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 print:hidden">
        <Link href={`/admin/reservations/${reference}`} className="text-sm text-primary underline underline-offset-2">
          ‹ Dossier {reference}
        </Link>
        <Button onClick={() => window.print()}>Imprimer / PDF</Button>
      </div>

      <div className="mx-auto max-w-[210mm] rounded-lg border bg-white p-10 text-[13px] leading-relaxed text-neutral-900 shadow-sm print:max-w-none print:rounded-none print:border-0 print:p-0 print:shadow-none">
        <div className="flex items-start justify-between border-b pb-6">
          <div>
            <div className="text-2xl" style={{ fontFamily: "'Marcellus',serif" }}>{seller.propertyName}</div>
            <div className="text-neutral-500">Location de meublé de tourisme · {seller.locationLabel}</div>
            <div className="mt-2 text-neutral-500">
              {seller.ownerName || "—"}
              {seller.ownerAddress && <><br />{seller.ownerAddress}</>}
              {seller.ownerSiret && <><br />SIRET {seller.ownerSiret}</>}
            </div>
          </div>
          <div className="text-right">
            <div className="text-lg font-semibold">Facture de séjour</div>
            <div className="font-medium">N° {invoice.number}</div>
            <div className="text-neutral-500">Émise le {dd(invoice.issuedAt)}<br />Réservation {stay.reference}</div>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-6">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Client</div>
            <div className="mt-1 font-medium">{customer.name ?? "—"}</div>
            {customer.address && <div>{customer.address}</div>}
            {customer.email && <div>{customer.email}</div>}
            {customer.phone && <div>{customer.phone}</div>}
          </div>
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Séjour</div>
            <div className="mt-1">Du <strong>{dd(stay.startDate)}</strong> au <strong>{departure(stay.startDate, stay.nights)}</strong></div>
            <div>{stay.adults} adulte(s){stay.minors > 0 ? ` · ${stay.minors} mineur(s)` : ""} — {stay.nights} nuits</div>
          </div>
        </div>

        <table className="mt-8 w-full border-collapse">
          <thead><tr className="border-b text-left text-xs uppercase tracking-wide text-neutral-500">
            <th className="py-2 font-semibold">Désignation</th><th className="py-2 text-right font-semibold">Qté</th>
            <th className="py-2 text-right font-semibold">Prix unitaire</th><th className="py-2 text-right font-semibold">Montant</th>
          </tr></thead>
          <tbody>{lines.map((line, i) => <tr key={`${line.kind}-${i}`} className="border-b border-neutral-100">
            <td className="py-2">{line.label}</td><td className="py-2 text-right">{line.quantity}</td>
            <td className="py-2 text-right">{fmtEur(line.unitPriceCents)}</td><td className="py-2 text-right">{fmtEur(line.totalCents)}</td>
          </tr>)}</tbody>
          <tfoot>
            <tr><td colSpan={3} className="py-3 text-right font-semibold">Total</td><td className="py-3 text-right text-base font-semibold">{fmtEur(invoice.totalCents)}</td></tr>
            {stay.touristTaxCents > 0 && stay.touristTaxIncluded && <tr><td colSpan={3} className="text-right text-neutral-500">dont taxe de séjour</td><td className="text-right text-neutral-500">{fmtEur(stay.touristTaxCents)}</td></tr>}
          </tfoot>
        </table>

        <div className="mt-8">
          <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Règlements</div>
          <table className="mt-1 w-full"><tbody>
            <tr><td className="py-1">Acompte ({payment.depositPct} %)</td><td className="py-1 text-right">{fmtEur(payment.depositCents)}</td><td className="py-1 pl-6 text-neutral-500">{payment.depositPaidAt ? `réglé le ${dd(payment.depositPaidAt)}` : "à régler"}</td></tr>
            <tr><td className="py-1">Solde</td><td className="py-1 text-right">{fmtEur(payment.balanceCents)}</td><td className="py-1 pl-6 text-neutral-500">{payment.balancePaidAt ? `réglé le ${dd(payment.balancePaidAt)}` : "à régler"}</td></tr>
            {payment.remainingCents > 0 && <tr className="font-semibold"><td className="py-1">Reste dû</td><td className="py-1 text-right">{fmtEur(payment.remainingCents)}</td><td /></tr>}
          </tbody></table>
        </div>

        {payment.settled && <p className="mt-6 font-medium">Le propriétaire reconnaît avoir reçu le paiement intégral du séjour, soit {fmtEur(invoice.totalCents)}, et en donne quittance.</p>}
        {stay.cautionCents > 0 && <p className="mt-4 text-neutral-500">Dépôt de garantie : {fmtEur(stay.cautionCents)}. Il ne constitue pas un revenu et n&apos;apparaît pas au total.</p>}
        <p className="mt-4 text-neutral-500">{seller.vatMention}</p>
        <p className="mt-8 border-t pt-4 text-xs text-neutral-400">Document immuable n° {invoice.number}, établi pour la réservation {stay.reference}. Taxe de séjour reversée à la collectivité.</p>
      </div>
    </div>
  );
}
