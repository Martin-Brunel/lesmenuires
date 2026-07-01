import Link from "next/link";

export default function NotFound() {
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
        ERREUR 404
      </p>
      <h1 style={{ fontFamily: "Marcellus, serif", fontSize: "2.25rem", margin: 0 }}>
        Page introuvable
      </h1>
      <p style={{ maxWidth: "28rem", color: "#5b6670", lineHeight: 1.6 }}>
        La page que vous cherchez n’existe pas ou a été déplacée.
      </p>
      <Link
        href="/"
        style={{
          marginTop: "0.5rem",
          padding: "0.75rem 1.5rem",
          borderRadius: "999px",
          background: "#4E6E8C",
          color: "#fff",
          textDecoration: "none",
          fontWeight: 600,
        }}
      >
        Retour à l’accueil
      </Link>
    </main>
  );
}
