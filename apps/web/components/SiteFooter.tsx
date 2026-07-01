import Link from "next/link";
import { site } from "@/lib/site";

/** Shared footer with the mandatory legal links (LCEN / RGPD / consumer law). */
export function SiteFooter() {
  const year = site.legalUpdatedAt.slice(0, 4);
  const linkStyle: React.CSSProperties = {
    color: "#6B6E6B",
    textDecoration: "none",
    font: "400 13px 'Hanken Grotesk', system-ui, sans-serif",
  };
  return (
    <footer
      style={{
        background: "#F5F4F1",
        borderTop: "1px solid rgba(0,0,0,.08)",
        padding: "26px 22px",
        fontFamily: "'Hanken Grotesk', system-ui, sans-serif",
      }}
    >
      <div
        style={{
          maxWidth: 960,
          margin: "0 auto",
          display: "flex",
          flexWrap: "wrap",
          gap: "14px 22px",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div style={{ font: "400 20px 'Marcellus', serif", color: "#1A1B1A" }}>
          {site.name} <span style={{ fontSize: 13, color: "#9A9C97" }}>· {site.location}</span>
        </div>
        <nav style={{ display: "flex", flexWrap: "wrap", gap: "8px 18px" }}>
          <Link href="/mentions-legales" style={linkStyle}>Mentions légales</Link>
          <Link href="/cgv" style={linkStyle}>Conditions de location</Link>
          <Link href="/confidentialite" style={linkStyle}>Confidentialité</Link>
          <Link href="/cookies" style={linkStyle}>Cookies</Link>
          <Link href="/espace" style={linkStyle}>Mon espace</Link>
        </nav>
      </div>
      <div
        style={{
          maxWidth: 960,
          margin: "14px auto 0",
          font: "400 12px 'Hanken Grotesk', system-ui, sans-serif",
          color: "#9A9C97",
        }}
      >
        © {year} {site.name}. Tous droits réservés.
      </div>
    </footer>
  );
}
