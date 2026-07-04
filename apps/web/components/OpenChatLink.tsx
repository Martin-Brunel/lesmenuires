"use client";

import { useI18n } from "@/components/I18nProvider";

/** Lien « Nous contacter » (footer / pages serveur) : ouvre le widget de chat
 *  monté dans le layout racine via un événement global. */
export function OpenChatLink({ style }: { style?: React.CSSProperties }) {
  const { t } = useI18n();
  return (
    <button
      onClick={() => window.dispatchEvent(new Event("adret:open-chat"))}
      style={{
        border: "none",
        background: "transparent",
        padding: 0,
        cursor: "pointer",
        color: "#6B6E6B",
        font: "400 13px 'Hanken Grotesk', system-ui, sans-serif",
        ...style,
      }}
    >
      {t.nav.contact}
    </button>
  );
}
