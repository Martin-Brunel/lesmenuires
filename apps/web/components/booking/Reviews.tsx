"use client";

// Avis voyageurs publiés sur la page de réservation (résumé + liste).
// Inline-styled : Tailwind est réservé à /admin.

import { useState } from "react";
import type { ApiReview } from "@/lib/api";
import { css } from "./css";

function StarIcon({ size = 14, filled = true }: { size?: number; filled?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden style={{ flex: "none" }}>
      <path
        d="M12 2.5l2.94 5.96 6.58.96-4.76 4.64 1.12 6.55L12 17.52l-5.88 3.09 1.12-6.55-4.76-4.64 6.58-.96L12 2.5z"
        fill={filled ? "#E5A33D" : "none"}
        stroke={filled ? "#E5A33D" : "#C9C8C2"}
        strokeWidth="1.4"
      />
    </svg>
  );
}

export const avgRating = (reviews: ApiReview[]) =>
  reviews.length === 0
    ? null
    : reviews.reduce((s, r) => s + r.rating, 0) / reviews.length;

const fmtAvg = (avg: number) =>
  avg.toLocaleString("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** « ★ 4,8 · 12 avis » — à côté du titre. Rien tant qu'aucun avis publié. */
export function RatingBadge({ reviews }: { reviews: ApiReview[] }) {
  const avg = avgRating(reviews);
  if (avg === null) return null;
  return (
    <span style={css("display:inline-flex;align-items:center;gap:5px;font:500 14px 'Hanken Grotesk';color:#1A1B1A")}>
      <StarIcon />
      {fmtAvg(avg)}
      <span style={css("color:#9A9C97;font-weight:400")}>
        · {reviews.length} avis
      </span>
    </span>
  );
}

const frMonth = (iso: string) =>
  new Date(iso).toLocaleDateString("fr-FR", { month: "long", year: "numeric" });

/** Section « Avis des voyageurs » : liste repliée à 4, réponse de l'hôte. */
export function ReviewsSection({ reviews }: { reviews: ApiReview[] }) {
  const [expanded, setExpanded] = useState(false);
  const avg = avgRating(reviews);
  if (avg === null) return null;
  const shown = expanded ? reviews : reviews.slice(0, 4);
  return (
    <div>
      <div style={css("display:flex;align-items:baseline;gap:12px;flex-wrap:wrap")}>
        <h2 style={css("margin:0;font:400 28px 'Marcellus'")}>Avis des voyageurs</h2>
        <span style={css("display:inline-flex;align-items:center;gap:5px;font:500 15px 'Hanken Grotesk'")}>
          <StarIcon size={15} />
          {fmtAvg(avg)}
          <span style={css("color:#9A9C97;font-weight:400")}>· {reviews.length} avis</span>
        </span>
      </div>
      <div style={css("margin-top:18px;display:flex;flex-direction:column;gap:14px")}>
        {shown.map((r, i) => (
          <div key={i} style={css("background:#FFF;border:1px solid rgba(0,0,0,.07);border-radius:14px;padding:18px 20px")}>
            <div style={css("display:flex;align-items:center;gap:10px;flex-wrap:wrap")}>
              <span style={css("display:inline-flex;gap:2px")}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <StarIcon key={n} size={13} filled={n <= r.rating} />
                ))}
              </span>
              <span style={css("font:500 14px 'Hanken Grotesk';color:#1A1B1A")}>{r.authorName}</span>
              <span style={css("font:400 12.5px 'Hanken Grotesk';color:#9A9C97")}>{frMonth(r.submittedAt)}</span>
            </div>
            {r.comment && (
              <p style={css("margin:10px 0 0;font:400 14.5px/1.65 'Hanken Grotesk';color:#5A5C58;white-space:pre-line")}>
                {r.comment}
              </p>
            )}
            {r.adminReply && (
              <div style={css("margin-top:12px;padding:10px 14px;background:#F5F4F1;border-radius:10px")}>
                <div style={css("font:600 12px 'Hanken Grotesk';color:#9A9C97")}>Réponse de votre hôte</div>
                <p style={css("margin:4px 0 0;font:400 13.5px/1.6 'Hanken Grotesk';color:#5A5C58;white-space:pre-line")}>
                  {r.adminReply}
                </p>
              </div>
            )}
          </div>
        ))}
      </div>
      {reviews.length > 4 && !expanded && (
        <button
          onClick={() => setExpanded(true)}
          style={css("margin-top:14px;background:none;border:1px solid rgba(0,0,0,.14);border-radius:10px;padding:10px 16px;font:500 13.5px 'Hanken Grotesk';color:#1A1B1A;cursor:pointer")}
        >
          Voir les {reviews.length} avis
        </button>
      )}
    </div>
  );
}
