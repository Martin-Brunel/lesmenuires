"use client";

// Signature électronique du contrat par lien e-mail (réservations manuelles),
// puis copie consultable / imprimable du contrat signé — le lien reste valable.
// Page publique : stylée en inline comme le reste du site (Tailwind est
// réservé à /admin).

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
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
  ownerName: string;
  ownerAddress: string;
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
    ownerName: d.ownerName,
    ownerAddress: d.ownerAddress,
  });

const S: Record<string, CSSProperties> = {
  page: { maxWidth: 680, margin: "0 auto", padding: "40px 20px 64px" },
  card: {
    background: "#fff",
    border: "1px solid #E5E4DF",
    borderRadius: 12,
    padding: "36px 40px",
    boxShadow: "0 1px 3px rgba(26,27,26,.06)",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 16,
    borderBottom: "1px solid #E5E4DF",
    paddingBottom: 20,
    flexWrap: "wrap",
  },
  title: { font: "400 28px 'Marcellus', serif", color: "#1A1B1A" },
  subtitle: { fontSize: 14, color: "#8A8B86", marginTop: 2 },
  meta: { fontSize: 13, color: "#8A8B86", textAlign: "right", lineHeight: 1.6 },
  parties: { fontSize: 14, marginTop: 20, lineHeight: 1.6 },
  text: {
    whiteSpace: "pre-line",
    fontSize: 14,
    lineHeight: 1.7,
    color: "#3A3B38",
    marginTop: 20,
  },
  section: { borderTop: "1px solid #E5E4DF", marginTop: 28, paddingTop: 20 },
  signedNote: { fontSize: 14, fontWeight: 600, color: "#1F7A46" },
  sigImg: {
    height: 96,
    marginTop: 12,
    border: "1px solid #E5E4DF",
    borderRadius: 8,
    background: "#fff",
    display: "block",
  },
  checkboxRow: {
    display: "flex",
    alignItems: "flex-start",
    gap: 8,
    fontSize: 14,
    lineHeight: 1.5,
    cursor: "pointer",
  },
  padWrap: { marginTop: 16 },
  actions: { display: "flex", alignItems: "center", gap: 14, marginTop: 14 },
  primaryBtn: {
    background: "#1A1B1A",
    color: "#fff",
    border: "none",
    borderRadius: 8,
    padding: "10px 18px",
    fontSize: 14,
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: "inherit",
  },
  linkBtn: {
    background: "none",
    border: "none",
    padding: 0,
    fontSize: 14,
    color: "#8A8B86",
    textDecoration: "underline",
    textUnderlineOffset: 3,
    cursor: "pointer",
    fontFamily: "inherit",
  },
  error: { color: "#B3261E", fontSize: 14, marginTop: 12 },
  muted: { color: "#8A8B86", fontSize: 12, marginTop: 8 },
  center: { maxWidth: 480, margin: "0 auto", padding: "80px 20px", textAlign: "center" },
};

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
      <main style={S.center}>
        <p style={{ color: "#B3261E", fontSize: 14 }}>{error}</p>
      </main>
    );
  }
  if (!data) {
    return (
      <main style={S.center}>
        <p style={{ color: "#8A8B86", fontSize: 14 }}>Chargement…</p>
      </main>
    );
  }

  const text = buildText(data);

  return (
    <main style={S.page}>
      {/* Impression : ne garder que le contrat, sur fond blanc. */}
      <style>{`
        @media print {
          body { background: #fff !important; }
          .no-print { display: none !important; }
          .contract-card { border: none !important; box-shadow: none !important; padding: 0 !important; }
        }
      `}</style>
      <div style={S.card} className="contract-card">
        <div style={S.header}>
          <div>
            <div style={S.title}>{data.propertyName}</div>
            <div style={S.subtitle}>Contrat de location saisonnière</div>
          </div>
          <div style={S.meta}>
            Réservation {data.reference}
            <br />
            Semaine du {data.weekRange}
          </div>
        </div>

        <p style={S.parties}>
          <strong>Preneur :</strong> {data.customerName ?? "—"} ·{" "}
          <strong>Arrivée :</strong> {data.arrival}
        </p>

        <div style={S.text}>{text}</div>

        {data.signed ? (
          <div style={S.section}>
            <p style={S.signedNote}>
              Contrat signé électroniquement
              {data.signedAt
                ? ` le ${new Date(data.signedAt).toLocaleString("fr-FR", { dateStyle: "long", timeStyle: "short" })}`
                : ""}
              .
            </p>
            {data.signaturePng && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={data.signaturePng} alt="Signature du preneur" style={S.sigImg} />
            )}
            <div className="no-print">
              <div style={S.actions}>
                <button style={S.primaryBtn} onClick={() => window.print()}>
                  Imprimer / Enregistrer en PDF
                </button>
              </div>
              <p style={S.muted}>Conservez ce lien : il reste votre copie du contrat signé.</p>
            </div>
          </div>
        ) : (
          <div style={S.section} className="no-print">
            <label style={S.checkboxRow}>
              <input
                type="checkbox"
                style={{ marginTop: 3 }}
                checked={accepted}
                onChange={(e) => setAccepted(e.target.checked)}
              />
              <span>J&apos;ai lu le contrat et les conditions générales, et je les accepte.</span>
            </label>
            <div style={S.padWrap}>
              <SignaturePad
                ref={padRef}
                width={560}
                height={160}
                fullWidth
                placeholder="Signez ici avec la souris ou le doigt"
                onEmptyChange={setSigEmpty}
              />
            </div>
            <div style={S.actions}>
              <button
                style={{
                  ...S.primaryBtn,
                  opacity: busy || !accepted || sigEmpty ? 0.5 : 1,
                  cursor: busy || !accepted || sigEmpty ? "default" : "pointer",
                }}
                disabled={busy || !accepted || sigEmpty}
                onClick={sign}
              >
                {busy ? "…" : "Signer le contrat"}
              </button>
              <button style={S.linkBtn} onClick={() => padRef.current?.clear()}>
                Effacer
              </button>
            </div>
            {error && <p style={S.error}>{error}</p>}
          </div>
        )}
      </div>
    </main>
  );
}
