"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { ACCENT } from "./data";
import { useI18n } from "@/components/I18nProvider";
import type { Amenity } from "@/lib/amenities";
import { AmenitiesSection } from "./Amenities";

/**
 * Renders the presentation text — rich HTML from the editor, or plain text
 * (line breaks preserved) for legacy content — clamped to ~`lines` lines with a
 * fade and a « Voir plus » modal when it overflows.
 */
export function ReadMore({
  content,
  lines = 5,
  textStyle,
  fadeColor = "#F5F4F1",
  amenities = [],
}: {
  content: string;
  lines?: number;
  textStyle?: CSSProperties;
  fadeColor?: string;
  amenities?: Amenity[];
}) {
  const { locale, t } = useI18n();
  const [open, setOpen] = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const isHtml = /<[a-z][\s\S]*>/i.test(content);
  const collapsedMax = `${(lines * 1.65).toFixed(2)}em`;
  const title = locale === "en" ? "About this place" : "À propos du logement";

  useEffect(() => {
    const el = ref.current;
    if (el) setOverflowing(el.scrollHeight > el.clientHeight + 2);
  }, [content, textStyle, lines]);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const boxStyle: CSSProperties = {
    ...textStyle,
    maxHeight: collapsedMax,
    overflow: "hidden",
  };

  return (
    <div>
      <div style={{ position: "relative" }}>
        {isHtml ? (
          <div
            ref={ref}
            className="rich-text"
            style={boxStyle}
            dangerouslySetInnerHTML={{ __html: content }}
          />
        ) : (
          <div ref={ref} style={{ ...boxStyle, whiteSpace: "pre-line" }}>
            {content}
          </div>
        )}
        {overflowing && (
          <div
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              bottom: 0,
              height: "2.4em",
              background: `linear-gradient(to bottom, transparent, ${fadeColor})`,
              pointerEvents: "none",
            }}
          />
        )}
      </div>
      {overflowing && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          style={{
            marginTop: 8,
            background: "none",
            border: "none",
            padding: 0,
            cursor: "pointer",
            font: "500 13px 'Hanken Grotesk', system-ui, sans-serif",
            color: ACCENT,
          }}
        >
          {t.readMore.more}
        </button>
      )}
      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="description-modal-title"
          onMouseDown={() => setOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 80,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "18px",
            background: "rgba(17,18,17,.42)",
          }}
        >
          <div
            onMouseDown={(e) => e.stopPropagation()}
            style={{
              width: "min(760px, 100%)",
              maxHeight: "min(82vh, 760px)",
              overflow: "auto",
              borderRadius: 18,
              background: "#FFF",
              boxShadow: "0 24px 80px rgba(0,0,0,.24)",
              padding: "26px 28px 30px",
            }}
          >
            <div style={{ display: "flex", alignItems: "flex-start", gap: 18, justifyContent: "space-between" }}>
              <h2 id="description-modal-title" style={{ margin: 0, font: "400 30px 'Marcellus'", color: "#1A1B1A" }}>
                {title}
              </h2>
              <button
                type="button"
                aria-label={locale === "en" ? "Close" : "Fermer"}
                onClick={() => setOpen(false)}
                style={{
                  width: 36,
                  height: 36,
                  flex: "0 0 auto",
                  borderRadius: "50%",
                  border: "1px solid rgba(0,0,0,.12)",
                  background: "#FFF",
                  cursor: "pointer",
                  font: "400 22px/1 'Hanken Grotesk'",
                  color: "#1A1B1A",
                }}
              >
                ×
              </button>
            </div>
            {isHtml ? (
              <div
                className="rich-text"
                style={{
                  marginTop: 18,
                  font: "400 16px/1.75 'Hanken Grotesk'",
                  color: "#4E504D",
                }}
                dangerouslySetInnerHTML={{ __html: content }}
              />
            ) : (
              <div
                style={{
                  marginTop: 18,
                  whiteSpace: "pre-line",
                  font: "400 16px/1.75 'Hanken Grotesk'",
                  color: "#4E504D",
                }}
              >
                {content}
              </div>
            )}
            <AmenitiesSection amenities={amenities} locale={locale} />
          </div>
        </div>
      )}
    </div>
  );
}
