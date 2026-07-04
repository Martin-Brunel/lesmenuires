"use client";

import { AmenityIconGlyph } from "@/components/AmenityIconGlyph";
import type { Amenity } from "@/lib/amenities";
import type { Locale } from "@/lib/i18n";
import { css } from "./css";

export function AmenitiesSection({
  amenities,
  locale,
  compact = false,
}: {
  amenities: Amenity[];
  locale: Locale;
  compact?: boolean;
}) {
  const visible = amenities
    .map((a) => ({
      ...a,
      label: locale === "en" && a.labelEn?.trim() ? a.labelEn.trim() : a.label.trim(),
    }))
    .filter((a) => a.label);

  if (visible.length === 0) return null;

  return (
    <section style={css(compact ? "margin-top:22px" : "margin-top:30px")}>
      <h2 style={css(compact ? "margin:0 0 12px;font:400 23px 'Marcellus'" : "margin:0 0 16px;font:400 28px 'Marcellus'")}>
        {locale === "en" ? "What this place offers" : "Ce que propose le logement"}
      </h2>
      <div
        style={css(
          compact
            ? "display:grid;grid-template-columns:1fr 1fr;gap:10px"
            : "display:grid;grid-template-columns:1fr 1fr;gap:13px 18px;max-width:620px",
        )}
      >
        {visible.map((a, i) => {
          return (
            <div
              key={`${a.icon}-${a.label}-${i}`}
              style={css(
                compact
                  ? "display:flex;align-items:center;gap:9px;min-width:0;padding:10px 0;border-bottom:1px solid rgba(0,0,0,.08)"
                  : "display:flex;align-items:center;gap:12px;min-width:0;padding:4px 0",
                )}
            >
              <AmenityIconGlyph icon={a.icon} size={compact ? 19 : 22} color="#1A1B1A" style={{ flex: "0 0 auto" }} />
              <span
                style={css(
                  compact
                    ? "min-width:0;font:500 13px/1.25 'Hanken Grotesk';color:#1A1B1A"
                    : "min-width:0;font:500 15px/1.35 'Hanken Grotesk';color:#1A1B1A",
                )}
              >
                {a.label}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
