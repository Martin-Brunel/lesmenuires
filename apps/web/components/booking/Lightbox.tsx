"use client";

import { useCallback, useEffect } from "react";

type Img = { url: string; alt: string };

/** Full-screen photo viewer: prev/next, thumbnails, keyboard (← → Esc). */
export function Lightbox({
  images,
  index,
  onChange,
  onClose,
}: {
  images: Img[];
  index: number;
  onChange: (i: number) => void;
  onClose: () => void;
}) {
  const prev = useCallback(
    () => onChange((index - 1 + images.length) % images.length),
    [index, images.length, onChange],
  );
  const next = useCallback(
    () => onChange((index + 1) % images.length),
    [index, images.length, onChange],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft") prev();
      else if (e.key === "ArrowRight") next();
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose, prev, next]);

  if (images.length === 0) return null;
  const img = images[index];

  const arrow: React.CSSProperties = {
    position: "absolute",
    top: "50%",
    transform: "translateY(-50%)",
    width: 48,
    height: 48,
    borderRadius: "50%",
    background: "rgba(255,255,255,.12)",
    color: "#fff",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 26,
    cursor: "pointer",
    border: "none",
    userSelect: "none",
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        background: "rgba(16,16,15,.94)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        fontFamily: "'Hanken Grotesk', system-ui, sans-serif",
      }}
    >
      <button
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        aria-label="Fermer"
        style={{
          position: "absolute",
          top: 18,
          right: 20,
          width: 42,
          height: 42,
          borderRadius: "50%",
          background: "rgba(255,255,255,.12)",
          color: "#fff",
          border: "none",
          fontSize: 18,
          cursor: "pointer",
        }}
      >
        ✕
      </button>

      {images.length > 1 && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            prev();
          }}
          aria-label="Photo précédente"
          style={{ ...arrow, left: 20 }}
        >
          ‹
        </button>
      )}
      {images.length > 1 && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            next();
          }}
          aria-label="Photo suivante"
          style={{ ...arrow, right: 20 }}
        >
          ›
        </button>
      )}

      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={img.url}
        alt={img.alt}
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: "min(1100px, 92vw)",
          maxHeight: "76vh",
          objectFit: "contain",
          borderRadius: 8,
          boxShadow: "0 20px 60px rgba(0,0,0,.5)",
        }}
      />

      <div style={{ marginTop: 16, color: "rgba(255,255,255,.7)", fontSize: 13, fontWeight: 500 }}>
        {index + 1} / {images.length}
      </div>

      {images.length > 1 && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{ display: "flex", gap: 8, marginTop: 14, maxWidth: "92vw", overflowX: "auto", padding: 4 }}
        >
          {images.map((im, i) => (
            <button
              key={i}
              onClick={() => onChange(i)}
              aria-label={`Photo ${i + 1}`}
              style={{
                flex: "none",
                width: 60,
                height: 44,
                borderRadius: 6,
                border: i === index ? "2px solid #fff" : "2px solid transparent",
                padding: 0,
                cursor: "pointer",
                backgroundImage: `url('${im.url}')`,
                backgroundSize: "cover",
                backgroundPosition: "center",
                opacity: i === index ? 1 : 0.55,
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
