"use client";

// Signature électronique du contrat par lien e-mail (réservations manuelles),
// puis copie consultable / imprimable du contrat signé — le lien reste valable.

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import {
  SignaturePad,
  type SignaturePadHandle,
} from "@/components/booking/SignaturePad";
import { contractText } from "@/lib/contract";
import { CONTRACT_VERSION } from "@/lib/site";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

type ContractView = {
  reference: string;
  weekRange: string;
  arrival: string;
  customerName: string | null;
  propertyName: string;
  locationLabel: string;
  capacity: number;
  cautionCents: number;
  signed: boolean;
  signedAt: string | null;
  contractText: string | null;
  signaturePng: string | null;
};

const buildText = (d: ContractView) =>
  d.contractText ??
  contractText({
    propertyName: d.propertyName,
    locationLabel: d.locationLabel,
    cautionCents: d.cautionCents,
    capacity: d.capacity,
  });

export default function ContratPage() {
  const params = useParams<{ token: string }>();
  const token = params.token;
  const [data, setData] = useState<ContractView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [sigEmpty, setSigEmpty] = useState(true);
  const [busy, setBusy] = useState(false);
  const padRef = useRef<SignaturePadHandle>(null);

  const load = useCallback(() => {
    fetch(`${API_URL}/api/contract/${token}`)
      .then(async (r) => {
        if (!r.ok) throw new Error("Lien de contrat introuvable ou expiré.");
        setData(await r.json());
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Erreur"));
  }, [token]);
  useEffect(() => load(), [load]);

  const sign = async () => {
    if (!data || busy) return;
    const png = padRef.current?.toDataURL();
    if (!png) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/api/contract/${token}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          contractVersion: CONTRACT_VERSION,
          signaturePng: png,
          accepted: true,
          contractText: buildText(data),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "La signature n'a pas pu être enregistrée.");
      }
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur");
    } finally {
      setBusy(false);
    }
  };

  if (error && !data) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-16 text-center">
        <p className="text-sm text-red-700">{error}</p>
      </main>
    );
  }
  if (!data) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-16 text-center">
        <p className="text-sm text-neutral-500">Chargement…</p>
      </main>
    );
  }

  const text = buildText(data);

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <div className="rounded-lg border bg-white p-8 shadow-sm print:border-0 print:p-0 print:shadow-none">
        <div className="flex items-start justify-between gap-4 border-b pb-5">
          <div>
            <div className="text-2xl" style={{ fontFamily: "'Marcellus',serif" }}>
              {data.propertyName}
            </div>
            <div className="text-sm text-neutral-500">Contrat de location saisonnière</div>
          </div>
          <div className="text-right text-sm text-neutral-500">
            Réservation {data.reference}
            <br />
            Semaine du {data.weekRange}
          </div>
        </div>

        <div className="mt-5 text-sm">
          <p>
            <strong>Preneur :</strong> {data.customerName ?? "—"} ·{" "}
            <strong>Arrivée :</strong> {data.arrival}
          </p>
        </div>

        <div className="mt-5 whitespace-pre-line text-sm leading-relaxed text-neutral-800">
          {text}
        </div>

        {data.signed ? (
          <div className="mt-8 border-t pt-5">
            <p className="text-sm font-medium text-emerald-700">
              Contrat signé électroniquement
              {data.signedAt
                ? ` le ${new Date(data.signedAt).toLocaleString("fr-FR", { dateStyle: "long", timeStyle: "short" })}`
                : ""}
              .
            </p>
            {data.signaturePng && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={data.signaturePng}
                alt="Signature du preneur"
                className="mt-3 h-24 rounded border bg-white"
              />
            )}
            <button
              onClick={() => window.print()}
              className="mt-5 rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white print:hidden"
            >
              Imprimer / Enregistrer en PDF
            </button>
            <p className="mt-2 text-xs text-neutral-400 print:hidden">
              Conservez ce lien : il reste votre copie du contrat signé.
            </p>
          </div>
        ) : (
          <div className="mt-8 border-t pt-5 print:hidden">
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={accepted}
                onChange={(e) => setAccepted(e.target.checked)}
              />
              J&apos;ai lu le contrat et les conditions générales, et je les accepte.
            </label>
            <div className="mt-4">
              <SignaturePad
                ref={padRef}
                width={560}
                height={160}
                fullWidth
                placeholder="Signez ici avec la souris ou le doigt"
                onEmptyChange={setSigEmpty}
              />
            </div>
            <div className="mt-3 flex items-center gap-3">
              <button
                onClick={sign}
                disabled={busy || !accepted || sigEmpty}
                className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                {busy ? "…" : "Signer le contrat"}
              </button>
              <button
                onClick={() => padRef.current?.clear()}
                className="text-sm text-neutral-500 underline underline-offset-2"
              >
                Effacer
              </button>
            </div>
            {error && <p className="mt-3 text-sm text-red-700">{error}</p>}
          </div>
        )}
      </div>
    </main>
  );
}
