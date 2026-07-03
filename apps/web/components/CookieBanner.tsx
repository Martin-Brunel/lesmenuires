"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useI18n } from "@/components/I18nProvider";

const KEY = "adret-cookie-ack";

/** Lightweight cookie notice. The site loads no non-essential tracker before
 *  interaction (Stripe's technical cookies load only inside the payment modal),
 *  so this is an informational banner with acknowledgement + a link to details. */
export function CookieBanner() {
  const { t, href } = useI18n();
  const [show, setShow] = useState(false);

  useEffect(() => {
    try {
      if (!localStorage.getItem(KEY)) setShow(true);
    } catch {
      /* private mode: skip */
    }
  }, []);

  if (!show) return null;

  const ack = () => {
    try {
      localStorage.setItem(KEY, "1");
    } catch {
      /* ignore */
    }
    setShow(false);
  };

  return (
    <div
      role="dialog"
      aria-label={t.cookieBanner.aria}
      style={{
        position: "fixed",
        left: 16,
        right: 16,
        bottom: 16,
        zIndex: 200,
        maxWidth: 720,
        margin: "0 auto",
        background: "#FFFFFF",
        border: "1px solid #e6e5e1",
        borderRadius: 14,
        boxShadow: "0 12px 40px rgba(0,0,0,.16)",
        padding: "16px 18px",
        display: "flex",
        flexWrap: "wrap",
        gap: 12,
        alignItems: "center",
        justifyContent: "space-between",
        fontFamily: "'Hanken Grotesk', system-ui, sans-serif",
      }}
    >
      <p style={{ margin: 0, font: "400 13.5px/1.55 'Hanken Grotesk'", color: "#4a4c48", flex: "1 1 320px" }}>
        {t.cookieBanner.body}{" "}
        <Link href={href("/cookies")} style={{ color: "#4E6E8C" }}>
          {t.cookieBanner.learnMore}
        </Link>
        .
      </p>
      <button
        onClick={ack}
        style={{
          border: "none",
          background: "#1A1B1A",
          color: "#fff",
          borderRadius: 11,
          padding: "11px 20px",
          font: "600 13.5px 'Hanken Grotesk'",
          cursor: "pointer",
        }}
      >
        {t.cookieBanner.ok}
      </button>
    </div>
  );
}
