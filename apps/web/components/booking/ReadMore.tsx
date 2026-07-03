"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { ACCENT } from "./data";
import { useI18n } from "@/components/I18nProvider";

/**
 * Renders the presentation text — rich HTML from the editor, or plain text
 * (line breaks preserved) for legacy content — clamped to ~`lines` lines with a
 * fade and a « Voir plus / Voir moins » toggle when it overflows.
 */
export function ReadMore({
  content,
  lines = 5,
  textStyle,
  fadeColor = "#F5F4F1",
}: {
  content: string;
  lines?: number;
  textStyle?: CSSProperties;
  fadeColor?: string;
}) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const isHtml = /<[a-z][\s\S]*>/i.test(content);
  const collapsedMax = `${(lines * 1.65).toFixed(2)}em`;

  useEffect(() => {
    const el = ref.current;
    if (el) setOverflowing(el.scrollHeight > el.clientHeight + 2);
  }, [content, textStyle, lines]);

  const boxStyle: CSSProperties = {
    ...textStyle,
    maxHeight: expanded ? "none" : collapsedMax,
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
        {!expanded && overflowing && (
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
      {(overflowing || expanded) && (
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
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
          {expanded ? t.readMore.less : t.readMore.more}
        </button>
      )}
    </div>
  );
}
