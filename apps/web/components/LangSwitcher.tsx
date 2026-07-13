"use client";

// Sélecteur FR / EN : renvoie vers la même page dans l'autre langue.
// Rendu « pilules » aligné sur la direction Premium éditorial.

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { LOCALES, switchLocalePath, type Locale } from "@/lib/i18n";
import { useI18n } from "./I18nProvider";

export function LangSwitcher({ compact = false }: { compact?: boolean }) {
  const { englishEnabled, locale } = useI18n();
  const pathname = usePathname() ?? "/";
  // Preserve the query string (e.g. /reserver?token=… cart-resume link) when switching
  // language. Read it after mount rather than via useSearchParams, which would force a
  // Suspense boundary / dynamic rendering on the static pages that host this switcher.
  const [search, setSearch] = useState("");
  useEffect(() => setSearch(window.location.search), [pathname]);
  if (!englishEnabled) return null;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 3,
        font: `500 ${compact ? "11px" : "12px"} 'Hanken Grotesk', system-ui, sans-serif`,
      }}
    >
      {LOCALES.map((l: Locale) => {
        const active = l === locale;
        return (
          <a
            key={l}
            href={switchLocalePath(locale, l, pathname) + search}
            aria-current={active ? "true" : undefined}
            style={{
              padding: compact ? "4px 8px" : "5px 9px",
              borderRadius: 7,
              textDecoration: "none",
              background: active ? "#1A1B1A" : "transparent",
              color: active ? "#fff" : "#9A9C97",
            }}
          >
            {l.toUpperCase()}
          </a>
        );
      })}
    </div>
  );
}
