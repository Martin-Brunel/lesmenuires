"use client";

// Shared booking-flow orchestration for the desktop and mobile funnels.
// Owns the cart/payment state and the create→pay→confirm sequence so both
// funnels stay in lockstep (no divergence). Screen/navigation stays in each
// funnel (their models differ); this hook is UI-agnostic.

import { useEffect, useRef, useState } from "react";
import type { BookingContext } from "@/lib/api";
import {
  ApiError,
  confirmDeposit,
  createBooking,
  payDeposit,
  reserveOffline as reserveOfflineApi,
  resumeBooking,
  saveContract,
} from "@/lib/api";
import { CONTRACT_VERSION } from "@/lib/site";
import { contractText } from "@/lib/contract";
import { track } from "@/lib/analytics";
import {
  computeTotals,
  defaultExtras,
  monthKey,
  monthsOf,
  pickDefaultWeek,
  type ExtrasState,
} from "./data";
import { type SignaturePadHandle } from "./SignaturePad";

export type PayMethod = "card" | "cheque" | "virement";

export type ContactInfo = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  addressLine: string;
  postalCode: string;
  city: string;
};

const EMPTY_INFO: ContactInfo = {
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  addressLine: "",
  postalCode: "",
  city: "",
};

export function useBookingFlow(ctx: BookingContext, resumeRef?: string | null) {
  const { property, weeks, products } = ctx;

  const [info, setInfo] = useState<ContactInfo>(EMPTY_INFO);
  const setField =
    (k: keyof ContactInfo) => (e: React.ChangeEvent<HTMLInputElement>) =>
      setInfo((s) => ({ ...s, [k]: e.target.value }));

  const capacity = Math.max(1, property.capacity || 1);
  const [adults, setAdultsRaw] = useState(2);
  const [children, setChildrenRaw] = useState(0);
  // Selection changes invalidate the pending cart so totals/party stay correct.
  const [reference, setReference] = useState<string | null>(null);
  const invalidate = () => setReference(null);
  const setAdults = (n: number) => {
    setAdultsRaw(Math.min(capacity, Math.max(1, n)));
    invalidate();
  };
  const setChildren = (n: number) => {
    setChildrenRaw(Math.min(capacity, Math.max(0, n)));
    invalidate();
  };

  const [monthIdx, setMonthIdx] = useState(() => {
    const ms = monthsOf(weeks);
    const w = weeks[pickDefaultWeek(weeks)];
    const i = w ? ms.indexOf(monthKey(w.startDate)) : 0;
    return i < 0 ? 0 : i;
  });
  const [weekIdx, setWeekIdx] = useState(() => pickDefaultWeek(weeks));
  const [extras, setExtras] = useState<ExtrasState>(() => defaultExtras(products));
  // Moyen de règlement : CB par défaut si active, sinon le premier moyen actif
  // (dans l'ordre d'affichage : carte, virement, chèque).
  const [payMethod, setPayMethod] = useState<PayMethod>(() => {
    if (property.payCardEnabled) return "card";
    if (property.payVirementEnabled) return "virement";
    if (property.payChequeEnabled) return "cheque";
    return "card";
  });
  const [accepted, setAccepted] = useState(false);
  const [sigEmpty, setSigEmpty] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  // Synchronous re-entrancy lock: `submitting` is React state and only updates on
  // the next render, so two very fast clicks could both pass an `if (submitting)`
  // guard and double-submit. This ref is set/read synchronously, before any await.
  const busyRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [stripeSession, setStripeSession] = useState<{
    clientSecret: string;
    pk: string;
    reference: string;
  } | null>(null);
  const sigRef = useRef<SignaturePadHandle>(null);

  // Reprise de panier (`/reserver?ref=…`, lien de l'e-mail de relance) :
  // restaure la sélection, les coordonnées et la référence du panier, puis les
  // funnels sautent à l'étape « Vos infos ». Si la semaine n'est plus en vente
  // (réservée/bloquée entre-temps), on prévient et on repart de zéro.
  const [resumed, setResumed] = useState<"restored" | "unavailable" | null>(null);
  const resumeTried = useRef(false);
  useEffect(() => {
    if (!resumeRef || resumeTried.current) return;
    resumeTried.current = true;
    resumeBooking(resumeRef)
      .then((r) => {
        const idx = weeks.findIndex((w) => w.id === r.weekId);
        if (idx < 0 || weeks[idx].booked) {
          setResumed("unavailable");
          return;
        }
        setWeekIdx(idx);
        const mi = monthsOf(weeks).indexOf(monthKey(weeks[idx].startDate));
        if (mi >= 0) setMonthIdx(mi);
        setExtras(
          Object.fromEntries(products.map((p) => [p.key, r.extras.includes(p.key)])),
        );
        setAdultsRaw(Math.min(capacity, Math.max(1, r.adults)));
        setChildrenRaw(Math.min(capacity, Math.max(0, r.children)));
        setInfo(r.customer);
        setReference(r.reference);
        setResumed("restored");
        track("panier_repris");
      })
      .catch(() => setResumed("unavailable"));
    // Restauration one-shot au montage — les états listés sont des setters stables.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resumeRef]);

  const week = weeks[weekIdx];
  const months = monthsOf(weeks);
  const totals = week
    ? computeTotals(
        week.priceCents,
        products,
        extras,
        property.depositPct,
        property.touristTaxCents,
        adults,
        property.touristTaxIncluded,
      )
    : { extrasTotal: 0, total: 0, deposit: 0, balance: 0, touristTax: 0 };
  const selectedExtras = products.filter((x) => extras[x.key]);

  const infoComplete =
    info.firstName.trim() !== "" &&
    info.lastName.trim() !== "" &&
    /.+@.+\..+/.test(info.email) &&
    info.phone.trim() !== "" &&
    info.addressLine.trim() !== "" &&
    info.postalCode.trim() !== "" &&
    info.city.trim() !== "";

  const selectWeek = (i: number) => {
    if (!weeks[i]?.booked) {
      setWeekIdx(i);
      invalidate();
    }
  };
  const toggleExtra = (k: string) => {
    setExtras((s) => ({ ...s, [k]: !s[k] }));
    invalidate();
  };

  // Create the cart booking once the contact info is entered, so an abandoned
  // cart keeps the coordonnées for the relance.
  const ensureBooking = async (): Promise<string> => {
    if (reference) return reference;
    if (!week) throw new Error("Aucune semaine sélectionnée.");
    const res = await createBooking({
      propertySlug: property.slug,
      weekId: week.id,
      extras: selectedExtras.map((p) => p.key),
      adults,
      children,
      customer: { ...info, country: "FR" },
    });
    setReference(res.reference);
    track("panier_cree");
    return res.reference;
  };

  /** Ensure the cart exists; manages submitting/error. Returns success. */
  const ensureCart = async (): Promise<boolean> => {
    if (!infoComplete || busyRef.current) return false;
    busyRef.current = true;
    setSubmitting(true);
    setError(null);
    try {
      await ensureBooking();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Une erreur est survenue.");
      return false;
    } finally {
      busyRef.current = false;
      setSubmitting(false);
    }
  };

  /** Persist the signed contract before payment. Returns success; manages
   *  submitting/error so the funnel can block the step on failure. */
  const saveSignedContract = async (): Promise<boolean> => {
    if (busyRef.current) return false;
    const signaturePng = sigRef.current?.toDataURL() ?? null;
    if (!accepted || !signaturePng) {
      setError("Merci d'accepter le contrat et de signer.");
      return false;
    }
    busyRef.current = true;
    setSubmitting(true);
    setError(null);
    try {
      const ref = await ensureBooking();
      await saveContract(ref, {
        contractVersion: CONTRACT_VERSION,
        signaturePng,
        accepted,
        // Exact text the buyer signs — archived server-side as legal proof.
        contractText: contractText({
          propertyName: property.name,
          locationLabel: property.locationLabel,
          cautionCents: property.cautionCents,
          capacity,
          ownerName: property.ownerName,
          ownerAddress: property.ownerAddress,
          template: property.contractTemplate,
        }),
      });
      track("contrat_signe");
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Une erreur est survenue.");
      return false;
    } finally {
      busyRef.current = false;
      setSubmitting(false);
    }
  };

  /** Pay the deposit. If Stripe, opens the Payment Element (sets stripeSession)
   *  and calls nothing else; otherwise (mock) confirms and runs `onDone`. */
  const pay = async (onDone: () => void): Promise<void> => {
    if (busyRef.current) return;
    busyRef.current = true;
    setSubmitting(true);
    setError(null);
    try {
      const ref = await ensureBooking();
      const p = await payDeposit(ref);
      if (p.provider === "stripe" && p.publishableKey) {
        setStripeSession({ clientSecret: p.clientSecret, pk: p.publishableKey, reference: ref });
        return;
      }
      await confirmDeposit(ref);
      track("acompte_paye", { mode: "direct" });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Une erreur est survenue.");
    } finally {
      busyRef.current = false;
      setSubmitting(false);
    }
  };

  /** Finalise sans paiement en ligne (chèque/virement) : la réservation passe en
   *  `pending_payment` (semaine retenue) et le client règle hors ligne. */
  const reserveOffline = async (onDone: () => void): Promise<void> => {
    if (busyRef.current || payMethod === "card") return;
    busyRef.current = true;
    setSubmitting(true);
    setError(null);
    try {
      const ref = await ensureBooking();
      await reserveOfflineApi(ref, payMethod);
      track("reservation_offline", { mode: payMethod });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Une erreur est survenue.");
    } finally {
      busyRef.current = false;
      setSubmitting(false);
    }
  };

  /** Called by StripeCheckout once the card is confirmed. Must never throw: the
   *  card is already charged, so a failing confirm-deposit call must not trap the
   *  buyer on a dead spinner. The Stripe webhook confirms the booking server-side,
   *  so on failure we close the modal and show a reassuring message instead. */
  const finishStripe = async (onDone: () => void): Promise<void> => {
    if (!stripeSession) return;
    try {
      await confirmDeposit(stripeSession.reference);
      track("acompte_paye", { mode: "stripe" });
      onDone();
    } catch (e) {
      setStripeSession(null);
      // A 4xx is a definitive rejection the webhook won't fix (e.g. the week was
      // taken and the deposit refunded) — show its precise message. A transient
      // failure (network / 5xx) is reassured: the webhook confirms server-side.
      if (e instanceof ApiError && e.status >= 400 && e.status < 500) {
        setError(e.message);
      } else {
        setError(
          "Votre paiement a bien été accepté. La confirmation finale est en cours " +
            "et vous recevrez un e-mail ; vous pourrez suivre votre réservation " +
            "dans votre espace client.",
        );
      }
    }
  };

  const resetFlow = () => {
    setWeekIdx(pickDefaultWeek(weeks));
    setExtras(defaultExtras(products));
    setAccepted(false);
    setSigEmpty(true);
    setError(null);
    setReference(null);
    setStripeSession(null);
    sigRef.current?.clear();
  };

  return {
    info, setField, setInfo,
    adults, setAdults, children, setChildren, capacity,
    monthIdx, setMonthIdx, weekIdx, selectWeek,
    extras, toggleExtra, selectedExtras,
    accepted, setAccepted, sigEmpty, setSigEmpty, sigRef,
    reference, submitting, error, setError, resumed,
    stripeSession, setStripeSession,
    payMethod, setPayMethod,
    week, months, totals, infoComplete,
    ensureBooking, ensureCart, saveSignedContract, pay, reserveOffline, finishStripe, resetFlow,
  };
}
