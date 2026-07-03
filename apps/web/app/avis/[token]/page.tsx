"use client";

// Dépôt d'avis voyageur par lien e-mail (post-séjour). Page publique : stylée
// en inline comme le reste du site (Tailwind est réservé à /admin).

import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { useParams } from "next/navigation";
import { getReviewLink, submitReview, type ReviewLink } from "@/lib/api";
import { useI18n } from "@/components/I18nProvider";

const S: Record<string, CSSProperties> = {
  page: { maxWidth: 560, margin: "0 auto", padding: "48px 20px 64px" },
  card: {
    background: "#fff",
    border: "1px solid #E5E4DF",
    borderRadius: 12,
    padding: "36px 40px",
    boxShadow: "0 1px 3px rgba(26,27,26,.06)",
  },
  title: { font: "400 28px 'Marcellus', serif", color: "#1A1B1A" },
  subtitle: { fontSize: 14, color: "#8A8B86", marginTop: 4, lineHeight: 1.6 },
  label: {
    display: "block",
    fontSize: 13,
    fontWeight: 600,
    color: "#3A3B38",
    margin: "22px 0 8px",
  },
  starRow: { display: "flex", gap: 6 },
  starBtn: {
    background: "none",
    border: "none",
    padding: 2,
    cursor: "pointer",
    lineHeight: 1,
  },
  textarea: {
    width: "100%",
    boxSizing: "border-box" as const,
    border: "1px solid #E5E4DF",
    borderRadius: 8,
    padding: "10px 12px",
    fontSize: 14,
    lineHeight: 1.6,
    fontFamily: "inherit",
    color: "#1A1B1A",
    resize: "vertical" as const,
    minHeight: 110,
  },
  input: {
    width: "100%",
    boxSizing: "border-box" as const,
    border: "1px solid #E5E4DF",
    borderRadius: 8,
    padding: "10px 12px",
    fontSize: 14,
    fontFamily: "inherit",
    color: "#1A1B1A",
  },
  primaryBtn: {
    background: "#1A1B1A",
    color: "#fff",
    border: "none",
    borderRadius: 8,
    padding: "12px 22px",
    fontSize: 14,
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: "inherit",
    marginTop: 24,
  },
  error: { color: "#B3261E", fontSize: 14, marginTop: 12 },
  muted: { color: "#8A8B86", fontSize: 12, marginTop: 10, lineHeight: 1.5 },
  center: { maxWidth: 480, margin: "0 auto", padding: "80px 20px", textAlign: "center" },
  thanksTitle: { font: "400 24px 'Marcellus', serif", color: "#1A1B1A" },
};

function Stars({
  value,
  hover,
  onPick,
  onHover,
  starAria,
}: {
  value: number;
  hover: number;
  onPick: (n: number) => void;
  onHover: (n: number) => void;
  starAria: (n: number) => string;
}) {
  const shown = hover || value;
  return (
    <div style={S.starRow} onMouseLeave={() => onHover(0)}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          style={S.starBtn}
          aria-label={starAria(n)}
          onMouseEnter={() => onHover(n)}
          onClick={() => onPick(n)}
        >
          <svg width="34" height="34" viewBox="0 0 24 24" aria-hidden>
            <path
              d="M12 2.5l2.94 5.96 6.58.96-4.76 4.64 1.12 6.55L12 17.52l-5.88 3.09 1.12-6.55-4.76-4.64 6.58-.96L12 2.5z"
              fill={n <= shown ? "#E5A33D" : "none"}
              stroke={n <= shown ? "#E5A33D" : "#C9C8C2"}
              strokeWidth="1.4"
            />
          </svg>
        </button>
      ))}
    </div>
  );
}

export default function AvisPage() {
  const { t } = useI18n();
  const params = useParams<{ token: string }>();
  const token = params.token;
  const [data, setData] = useState<ReviewLink | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [comment, setComment] = useState("");
  const [author, setAuthor] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    getReviewLink(token)
      .then((d) => {
        setData(d);
        setAuthor((prev) => prev || d.firstName || "");
      })
      .catch(() => setError(t.avis.linkNotFound));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);
  useEffect(() => load(), [load]);

  const send = async () => {
    if (busy || rating === 0) return;
    setBusy(true);
    setError(null);
    try {
      await submitReview(token, { rating, comment, authorName: author });
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t.avis.errorShort);
    } finally {
      setBusy(false);
    }
  };

  if (error && !data) {
    return (
      <main style={S.center}>
        <p style={{ color: "#B3261E", fontSize: 14 }}>{error}</p>
      </main>
    );
  }
  if (!data) {
    return (
      <main style={S.center}>
        <p style={{ color: "#8A8B86", fontSize: 14 }}>{t.espace.loading}</p>
      </main>
    );
  }

  if (data.submitted) {
    return (
      <main style={S.page}>
        <div style={S.card}>
          <div style={S.thanksTitle}>{t.avis.thanksTitle}</div>
          <p style={S.subtitle}>
            {t.avis.thanksBody(data.propertyName, data.weekRange, data.rating)}
          </p>
          {data.comment && (
            <p style={{ ...S.subtitle, fontStyle: "italic", marginTop: 14 }}>
              « {data.comment} »
            </p>
          )}
        </div>
      </main>
    );
  }

  return (
    <main style={S.page}>
      <div style={S.card}>
        <div style={S.title}>{data.propertyName}</div>
        <p style={S.subtitle}>
          {t.avis.howWasStay(data.firstName, data.weekRange)}
        </p>

        <span style={S.label}>{t.avis.yourRating}</span>
        <Stars value={rating} hover={hover} onPick={setRating} onHover={setHover} starAria={t.avis.starAria} />
        <p style={{ fontSize: 13, color: "#8A8B86", marginTop: 6, minHeight: 18 }}>
          {(hover || rating) > 0 ? t.avis.ratingLabels[hover || rating] : " "}
        </p>

        <label style={S.label} htmlFor="avis-comment">
          {t.avis.commentLabel}
        </label>
        <textarea
          id="avis-comment"
          style={S.textarea}
          maxLength={4000}
          placeholder={t.avis.commentPlaceholder}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
        />

        <label style={S.label} htmlFor="avis-author">
          {t.avis.authorLabel}
        </label>
        <input
          id="avis-author"
          style={S.input}
          maxLength={120}
          value={author}
          onChange={(e) => setAuthor(e.target.value)}
        />

        <button
          style={{
            ...S.primaryBtn,
            opacity: busy || rating === 0 ? 0.5 : 1,
            cursor: busy || rating === 0 ? "default" : "pointer",
          }}
          disabled={busy || rating === 0}
          onClick={send}
        >
          {busy ? t.avis.sending : t.avis.send}
        </button>
        {error && <p style={S.error}>{error}</p>}
        <p style={S.muted}>
          {t.avis.disclaimer}
        </p>
      </div>
    </main>
  );
}
