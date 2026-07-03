"use client";

import { useMemo, useState } from "react";
import { loadStripe } from "@stripe/stripe-js";
import {
  Elements,
  PaymentElement,
  useElements,
  useStripe,
} from "@stripe/react-stripe-js";
import { useI18n } from "@/components/I18nProvider";

/** Modal that mounts Stripe's Payment Element to pay the deposit. */
export function StripeCheckout({
  publishableKey,
  clientSecret,
  amountLabel,
  onPaid,
  onClose,
}: {
  publishableKey: string;
  clientSecret: string;
  amountLabel: string;
  onPaid: () => Promise<void> | void;
  onClose: () => void;
}) {
  const { locale, t } = useI18n();
  const stripePromise = useMemo(() => loadStripe(publishableKey), [publishableKey]);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 120,
        background: "rgba(16,16,15,.6)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
        fontFamily: "'Hanken Grotesk', system-ui, sans-serif",
      }}
    >
      <div
        style={{
          background: "#FFF",
          borderRadius: 18,
          padding: 24,
          width: "min(440px, 100%)",
          maxHeight: "90vh",
          overflow: "auto",
          boxShadow: "0 24px 60px rgba(0,0,0,.3)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div style={{ font: "400 20px 'Marcellus', serif" }}>{t.checkout.stripeModalTitle}</div>
          <button
            onClick={onClose}
            aria-label={t.checkout.stripeClose}
            style={{ border: "none", background: "none", fontSize: 18, cursor: "pointer", color: "#9A9C97" }}
          >
            ✕
          </button>
        </div>
        <Elements stripe={stripePromise} options={{ clientSecret, locale }}>
          <PayForm amountLabel={amountLabel} onPaid={onPaid} />
        </Elements>
      </div>
    </div>
  );
}

function PayForm({
  amountLabel,
  onPaid,
}: {
  amountLabel: string;
  onPaid: () => Promise<void> | void;
}) {
  const { t } = useI18n();
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pay = async () => {
    if (!stripe || !elements) return;
    setBusy(true);
    setError(null);
    const { error: err, paymentIntent } = await stripe.confirmPayment({
      elements,
      redirect: "if_required",
    });
    if (err) {
      setError(err.message ?? t.checkout.stripePayFailed);
      setBusy(false);
      return;
    }
    if (paymentIntent && paymentIntent.status === "succeeded") {
      // onPaid handles confirmation; it must not throw, but guard anyway so the
      // button never stays frozen on "Paiement en cours…".
      try {
        await onPaid();
      } catch {
        setError(t.checkout.stripeAcceptedFinalizing);
        setBusy(false);
      }
      return;
    }
    setError(t.checkout.stripeNotFinalized);
    setBusy(false);
  };

  return (
    <div>
      <PaymentElement />
      {error && (
        <div style={{ marginTop: 12, font: "400 13px 'Hanken Grotesk'", color: "#B23B3B" }}>{error}</div>
      )}
      <button
        onClick={pay}
        disabled={busy || !stripe}
        style={{
          marginTop: 18,
          width: "100%",
          padding: 16,
          background: "#1A1B1A",
          color: "#fff",
          border: "none",
          borderRadius: 13,
          font: "600 14.5px 'Hanken Grotesk'",
          cursor: busy ? "default" : "pointer",
          opacity: busy ? 0.7 : 1,
        }}
      >
        {busy ? t.checkout.paying : t.checkout.pay(amountLabel)}
      </button>
      <div style={{ marginTop: 10, textAlign: "center", font: "400 11px 'Hanken Grotesk'", color: "#9A9C97" }}>
        🔒 {t.checkout.securePaymentShort}
      </div>
    </div>
  );
}
