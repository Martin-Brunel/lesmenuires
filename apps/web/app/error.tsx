"use client";

// Frontière d'erreur globale (App Router). Attrape les erreurs de rendu des
// routes et propose de réessayer sans recharger toute l'application.
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "1.25rem",
        padding: "2rem",
        textAlign: "center",
        background: "#faf8f5",
        color: "#1f2a33",
      }}
    >
      <p style={{ fontSize: "0.8rem", letterSpacing: "0.2em", color: "#4E6E8C" }}>
        UNE ERREUR EST SURVENUE
      </p>
      <h1 style={{ fontFamily: "Marcellus, serif", fontSize: "2rem", margin: 0 }}>
        Quelque chose s’est mal passé
      </h1>
      <p style={{ maxWidth: "28rem", color: "#5b6670", lineHeight: 1.6 }}>
        Merci de réessayer. Si le problème persiste, contactez-nous.
        {error.digest ? (
          <span style={{ display: "block", marginTop: "0.5rem", fontSize: "0.75rem", color: "#9aa4ad" }}>
            Référence : {error.digest}
          </span>
        ) : null}
      </p>
      <button
        onClick={reset}
        style={{
          marginTop: "0.5rem",
          padding: "0.75rem 1.5rem",
          borderRadius: "999px",
          background: "#4E6E8C",
          color: "#fff",
          border: "none",
          cursor: "pointer",
          fontWeight: 600,
        }}
      >
        Réessayer
      </button>
    </main>
  );
}
