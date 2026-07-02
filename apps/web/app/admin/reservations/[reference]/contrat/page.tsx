"use client";

// Contrat signé, version imprimable (PDF via l'impression navigateur) —
// la copie du propriétaire ; le client a la sienne via son lien de signature.

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { adminApi, type BookingDetail, type SignatureInfo } from "@/lib/admin-api";
import { Button } from "@/components/ui/button";

const dt = (iso: string) =>
  new Date(iso).toLocaleString("fr-FR", { dateStyle: "long", timeStyle: "short" });

export default function ContratAdminPage() {
  const params = useParams<{ reference: string }>();
  const reference = params.reference;
  const [data, setData] = useState<BookingDetail | null>(null);
  const [sig, setSig] = useState<SignatureInfo | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    adminApi.bookingDetail(reference).then(setData).catch(() => setError(true));
    adminApi.getSignature(reference).then(setSig).catch(() => {});
  }, [reference]);

  if (error) return <p className="text-sm text-destructive">Dossier introuvable.</p>;
  if (!data) return <p className="text-sm text-muted-foreground">Chargement…</p>;

  const b = data.booking;
  if (!b.contractSignedAt || !b.contractText) {
    return (
      <p className="text-sm text-muted-foreground">
        Pas de contrat signé sur ce dossier.{" "}
        <Link href={`/admin/reservations/${reference}`} className="text-primary underline">
          Retour au dossier
        </Link>
      </p>
    );
  }

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
        <div className="flex items-start justify-between border-b pb-6">
          <div>
            <div className="text-2xl" style={{ fontFamily: "'Marcellus',serif" }}>
              L&apos;Adret
            </div>
            <div className="text-neutral-500">Contrat de location saisonnière</div>
          </div>
          <div className="text-right text-neutral-500">
            Réservation {b.reference}
            <br />
            Semaine du {b.weekRange}
          </div>
        </div>

        <p className="mt-5">
          <strong>Preneur :</strong> {b.customerName ?? "—"}
          {b.customerAddress ? ` — ${b.customerAddress}` : ""}
          <br />
          <strong>Arrivée :</strong> {b.arrival} · {b.adults} adulte(s)
          {b.children > 0 ? ` · ${b.children} enfant(s)` : ""}
        </p>

        <div className="mt-5 whitespace-pre-line">{b.contractText}</div>

        <div className="mt-8 border-t pt-5">
          <p className="font-medium">
            Signé électroniquement le {dt(b.contractSignedAt)}
            {b.contractVersion ? ` (version ${b.contractVersion})` : ""}.
          </p>
          {sig?.signaturePng && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={sig.signaturePng}
              alt="Signature du preneur"
              className="mt-3 h-24 rounded border bg-white"
            />
          )}
        </div>
      </div>
    </div>
  );
}
