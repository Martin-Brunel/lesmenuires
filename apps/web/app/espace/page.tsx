"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  getMe,
  requestEspaceLink,
  logoutEspace,
  payBalance,
  confirmBalance,
  type MeResponse,
  type MyBooking,
  type MeProperty,
} from "@/lib/api";
import { ACCENT, eur, balanceDueLabel } from "@/components/booking/data";
import { css } from "@/components/booking/css";
import { StripeCheckout } from "@/components/booking/StripeCheckout";

const STATUS: Record<string, { label: string; color: string }> = {
  cart: { label: "Paiement en attente", color: "#B8860B" },
  pending_payment: { label: "En attente de règlement", color: "#B8860B" },
  confirmed: { label: "Confirmée", color: ACCENT },
  balance_paid: { label: "Soldée", color: "#2E7D5B" },
  cancelled: { label: "Annulée", color: "#9A9C97" },
};

function frDate(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
}

export default function EspacePage() {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [linkError, setLinkError] = useState(false);

  useEffect(() => {
    getMe()
      .then(setMe)
      .catch(() => setMe(null))
      .finally(() => setLoading(false));
    if (typeof window !== "undefined") {
      setLinkError(new URLSearchParams(window.location.search).get("error") === "lien");
    }
  }, []);

  const submitLink = async (e: React.FormEvent) => {
    e.preventDefault();
    if (sending || !/.+@.+\..+/.test(email)) return;
    setSending(true);
    await requestEspaceLink(email);
    setSent(true);
    setSending(false);
  };

  const logout = async () => {
    await logoutEspace();
    setMe(null);
    setSent(false);
    setEmail("");
  };

  const reload = () => getMe().then(setMe).catch(() => {});

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const isUpcoming = (b: MyBooking) =>
    b.status !== "cancelled" && new Date(b.startDate) >= today;

  const upcoming = (me?.bookings ?? [])
    .filter(isUpcoming)
    .sort((a, b) => +new Date(a.startDate) - +new Date(b.startDate));
  const past = (me?.bookings ?? [])
    .filter((b) => !isUpcoming(b))
    .sort((a, b) => +new Date(b.startDate) - +new Date(a.startDate));

  return (
    <div style={css("min-height:100vh;background:#F5F4F1;color:#1A1B1A;font-family:'Hanken Grotesk',system-ui,sans-serif")}>
      <div style={css("position:sticky;top:0;z-index:30;height:62px;background:rgba(245,244,241,.86);backdrop-filter:blur(10px);border-bottom:1px solid rgba(0,0,0,.08);display:flex;align-items:center;justify-content:space-between;padding:0 clamp(20px,5vw,40px)")}>
        <Link href="/reserver" style={css("font:400 24px 'Marcellus';letter-spacing:.02em;text-decoration:none;color:#1A1B1A")}>
          L&apos;Adret
        </Link>
        {me ? (
          <button
            onClick={logout}
            style={css("border:none;background:transparent;font:600 12px 'Hanken Grotesk';letter-spacing:.04em;color:#6B6E6B;cursor:pointer")}
          >
            Se déconnecter
          </button>
        ) : (
          <div style={css("font:500 12px 'Hanken Grotesk';letter-spacing:.08em;text-transform:uppercase;color:#9A9C97")}>
            Mon espace
          </div>
        )}
      </div>

      <div style={css("max-width:780px;margin:0 auto;padding:clamp(24px,5vw,44px)")}>
        {loading && <div style={css("color:#9A9C97;font:400 15px 'Hanken Grotesk'")}>Chargement…</div>}

        {!loading && !me && (
          <div style={css("max-width:440px;margin:36px auto 0;text-align:center")}>
            <h1 style={css("font:400 30px 'Marcellus'")}>Espace client</h1>
            <p style={css("margin:12px auto 0;max-width:400px;font:400 15px/1.6 'Hanken Grotesk';color:#6B6E6B")}>
              Saisissez votre e-mail : nous vous envoyons un lien de connexion sécurisé à votre espace séjour.
            </p>

            {linkError && (
              <div style={css("margin-top:18px;padding:12px 14px;border-radius:12px;background:#FBEAEA;font:400 13px 'Hanken Grotesk';color:#B23B3B")}>
                Ce lien est invalide ou expiré. Demandez-en un nouveau ci-dessous.
              </div>
            )}

            {sent ? (
              <div style={css(`margin-top:22px;padding:16px 18px;border-radius:14px;background:${ACCENT}12;font:400 14px/1.55 'Hanken Grotesk';color:#3f4b45`)}>
                ✓ Si un compte existe pour <b>{email}</b>, un lien de connexion vient d&apos;être envoyé. Vérifiez votre boîte (et vos spams).
              </div>
            ) : (
              <form onSubmit={submitLink} style={css("margin-top:22px;display:flex;gap:10px")}>
                <input
                  type="email"
                  required
                  placeholder="votre@email.fr"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  style={css("flex:1;background:#FFF;border:1px solid rgba(0,0,0,.12);border-radius:12px;padding:14px;font-size:14.5px;color:#1A1B1A")}
                />
                <button
                  type="submit"
                  disabled={sending}
                  style={css(`flex:none;padding:0 20px;border:none;border-radius:12px;background:#1A1B1A;color:#fff;font:600 14px 'Hanken Grotesk';cursor:pointer;${sending ? "opacity:.6;" : ""}`)}
                >
                  {sending ? "…" : "Recevoir le lien"}
                </button>
              </form>
            )}

            <Link href="/reserver" style={css("display:inline-block;margin-top:26px;font:500 13px 'Hanken Grotesk';color:#6B6E6B;text-decoration:underline")}>
              Réserver un nouveau séjour
            </Link>
          </div>
        )}

        {!loading && me && (
          <>
            <div style={css("margin-bottom:26px")}>
              <div style={css(`font:500 11px 'Hanken Grotesk';letter-spacing:.2em;text-transform:uppercase;color:${ACCENT}`)}>
                Bonjour {me.customer.firstName || me.customer.email}
              </div>
              <h1 style={css("margin:8px 0 0;font:400 34px 'Marcellus'")}>Votre espace séjour</h1>
            </div>

            {me.bookings.length === 0 && (
              <div style={css("background:#FFF;border:1px solid rgba(0,0,0,.08);border-radius:16px;padding:28px;text-align:center;color:#6B6E6B;font:400 15px 'Hanken Grotesk'")}>
                Aucune réservation pour le moment.
              </div>
            )}

            {/* Préparer le prochain séjour */}
            {upcoming[0] && me.property && (
              <PrepareStay next={upcoming[0]} property={me.property} />
            )}

            {upcoming.length > 0 && (
              <Section title="À venir">
                {upcoming.map((b) => (
                  <BookingCard key={b.reference} b={b} onReload={reload} />
                ))}
              </Section>
            )}

            {past.length > 0 && (
              <Section title="Séjours passés">
                {past.map((b) => (
                  <BookingCard key={b.reference} b={b} muted onReload={reload} />
                ))}
              </Section>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={css("margin-top:32px")}>
      <div style={css("font:500 11px 'Hanken Grotesk';letter-spacing:.16em;text-transform:uppercase;color:#9A9C97;margin-bottom:12px")}>
        {title}
      </div>
      {children}
    </div>
  );
}

function PrepareStay({ next, property }: { next: MyBooking; property: MeProperty }) {
  const rules = property.houseRules.split("\n").map((r) => r.trim()).filter(Boolean);
  const arrivalDays = Math.ceil((+new Date(next.startDate) - Date.now()) / 86_400_000);
  return (
    <div style={css(`background:linear-gradient(180deg,#FFFDF9,#FFF);border:1px solid ${ACCENT}33;border-radius:20px;padding:26px;box-shadow:0 16px 40px rgba(0,0,0,.06)`)}>
      <div style={css(`font:500 11px 'Hanken Grotesk';letter-spacing:.16em;text-transform:uppercase;color:${ACCENT}`)}>
        Préparer votre séjour{arrivalDays > 0 ? ` · dans ${arrivalDays} j` : ""}
      </div>
      <div style={css("margin-top:8px;font:400 24px 'Marcellus'")}>
        {property.name} — {next.weekRange}
      </div>
      <div style={css("margin-top:2px;font:400 13px 'Hanken Grotesk';color:#9A9C97")}>
        📍 {property.locationLabel} · arrivée {next.arrival}
      </div>

      {property.arrivalInstructions && (
        <div style={css("margin-top:20px")}>
          <div style={css("font:500 12px 'Hanken Grotesk';letter-spacing:.04em;color:#1A1B1A;margin-bottom:6px")}>
            Consignes d&apos;arrivée
          </div>
          <p style={css("margin:0;font:400 14px/1.65 'Hanken Grotesk';color:#5A5C58")}>
            {property.arrivalInstructions}
          </p>
        </div>
      )}

      {rules.length > 0 && (
        <div style={css("margin-top:20px")}>
          <div style={css("font:500 12px 'Hanken Grotesk';letter-spacing:.04em;color:#1A1B1A;margin-bottom:8px")}>
            Règlement intérieur
          </div>
          <div style={css("display:flex;flex-direction:column;gap:6px")}>
            {rules.map((r, i) => (
              <div key={i} style={css("display:flex;gap:9px;align-items:flex-start;font:400 13.5px/1.5 'Hanken Grotesk';color:#5A5C58")}>
                <span style={css(`flex:none;margin-top:6px;width:5px;height:5px;border-radius:50%;background:${ACCENT}`)} />
                {r}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function BookingCard({
  b,
  muted = false,
  onReload,
}: {
  b: MyBooking;
  muted?: boolean;
  onReload: () => void;
}) {
  const st = STATUS[b.status] ?? { label: b.status, color: "#9A9C97" };
  const cancelled = b.status === "cancelled";
  const [busy, setBusy] = useState(false);
  const [payErr, setPayErr] = useState<string | null>(null);
  const [stripeSession, setStripeSession] = useState<{ cs: string; pk: string } | null>(null);

  const startBalance = async () => {
    if (busy) return;
    setBusy(true);
    setPayErr(null);
    try {
      const p = await payBalance(b.reference);
      if (p.provider === "stripe" && p.publishableKey) {
        setStripeSession({ cs: p.clientSecret, pk: p.publishableKey });
      } else {
        await confirmBalance(b.reference);
        onReload();
      }
    } catch (e) {
      setPayErr(e instanceof Error ? e.message : "Une erreur est survenue.");
    } finally {
      setBusy(false);
    }
  };

  const onStripePaid = async () => {
    try {
      await confirmBalance(b.reference);
      setStripeSession(null);
      onReload();
    } catch {
      setStripeSession(null);
      setPayErr(
        "Votre paiement a été accepté. La confirmation est en cours ; rafraîchissez dans un instant.",
      );
    }
  };

  return (
    <div style={css(`background:#FFF;border:1px solid rgba(0,0,0,.08);border-radius:18px;padding:22px 24px;margin-bottom:14px;box-shadow:0 10px 26px rgba(0,0,0,.04);${muted ? "opacity:.75;" : ""}`)}>
      <div style={css("display:flex;align-items:flex-start;justify-content:space-between;gap:16px")}>
        <div>
          <div style={css("font:400 21px 'Marcellus'")}>{b.weekRange}</div>
          <div style={css("margin-top:3px;font:400 12.5px 'Hanken Grotesk';color:#9A9C97")}>
            Arrivée {b.arrival || "—"} · réf. {b.reference}
          </div>
        </div>
        <div style={css(`flex:none;padding:6px 12px;border-radius:9px;font:600 12px 'Hanken Grotesk';color:#fff;background:${st.color}`)}>
          {st.label}
        </div>
      </div>

      {b.status === "pending_payment" && (
        <div style={css("margin-top:12px;padding:11px 13px;border-radius:11px;background:#B8860B14;font:400 12.5px/1.55 'Hanken Grotesk';color:#8A6A10")}>
          Votre semaine est retenue — la réservation sera confirmée à réception de votre règlement.
        </div>
      )}

      <div style={css("margin-top:18px;padding-top:16px;border-top:1px solid rgba(0,0,0,.08);display:flex;flex-direction:column;gap:12px")}>
        <Milestone
          done={!!b.depositPaidAt}
          label="Acompte"
          detail={b.depositPaidAt ? `Payé le ${frDate(b.depositPaidAt)}` : "À régler"}
          amount={eur(b.depositCents)}
        />
        <Milestone
          done={!!b.balancePaidAt}
          disabled={cancelled}
          label="Solde"
          detail={
            cancelled
              ? "Non prélevé (annulation)"
              : b.balancePaidAt
                ? `Prélevé le ${frDate(b.balancePaidAt)}`
                : `Prélèvement le ${balanceDueLabel(b.startDate, 14)}`
          }
          amount={eur(b.balanceCents)}
        />
        <Milestone
          done={false}
          disabled={cancelled}
          label="Caution"
          detail={
            cancelled
              ? "Aucune caution"
              : "Garantie · votre carte n'est débitée qu'en cas de dégâts"
          }
          amount={eur(b.cautionCents)}
        />
      </div>

      {b.balancePayable && (
        <div style={css("margin-top:16px;padding-top:16px;border-top:1px solid rgba(0,0,0,.08)")}>
          {b.balanceFailed && (
            <div style={css("margin-bottom:10px;font:400 12.5px/1.5 'Hanken Grotesk';color:#B23B3B")}>
              Le prélèvement automatique du solde n&apos;a pas abouti. Réglez-le en ligne ci-dessous
              pour finaliser votre réservation.
            </div>
          )}
          {payErr && (
            <div style={css("margin-bottom:10px;font:400 12.5px 'Hanken Grotesk';color:#B23B3B")}>{payErr}</div>
          )}
          <div
            onClick={startBalance}
            style={css(`display:inline-block;padding:13px 22px;border-radius:12px;text-align:center;font:600 13.5px 'Hanken Grotesk';${busy ? "background:#D8D7D2;color:#fff;cursor:default;" : "background:#1A1B1A;color:#fff;cursor:pointer;"}`)}
          >
            {busy ? "Paiement en cours…" : `Régler le solde en ligne · ${eur(b.balanceCents)}`}
          </div>
        </div>
      )}

      {b.contractToken && (
        <div style={css("margin-top:14px")}>
          <a
            href={`/contrat/${b.contractToken}`}
            style={css("font:400 12.5px 'Hanken Grotesk';color:#6B6E6B;text-decoration:underline;text-underline-offset:3px")}
          >
            Voir mon contrat signé (imprimable)
          </a>
        </div>
      )}

      {stripeSession && (
        <StripeCheckout
          publishableKey={stripeSession.pk}
          clientSecret={stripeSession.cs}
          amountLabel={eur(b.balanceCents)}
          onPaid={onStripePaid}
          onClose={() => setStripeSession(null)}
        />
      )}
    </div>
  );
}

function Milestone({
  done,
  disabled = false,
  label,
  detail,
  amount,
}: {
  done: boolean;
  disabled?: boolean;
  label: string;
  detail: string;
  amount: string;
}) {
  const color = disabled ? "#C9C8C3" : done ? "#2E7D5B" : ACCENT;
  return (
    <div style={css("display:flex;align-items:center;gap:12px")}>
      <div style={css(`flex:none;width:20px;height:20px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11px;color:#fff;${done ? `background:${color};` : `background:#FFF;border:1.5px solid ${color};`}`)}>
        {done ? "✓" : ""}
      </div>
      <div style={css("flex:1")}>
        <div style={css(`font:600 13.5px 'Hanken Grotesk';color:${disabled ? "#9A9C97" : "#1A1B1A"}`)}>{label}</div>
        <div style={css("font:400 12px 'Hanken Grotesk';color:#9A9C97")}>{detail}</div>
      </div>
      <div style={css(`font-family:'Marcellus';font-size:15px;color:${disabled ? "#B6B5B0" : "#1A1B1A"}`)}>{amount}</div>
    </div>
  );
}
