import Link from "next/link";
import { SiteFooter } from "@/components/SiteFooter";
import { site } from "@/lib/site";

export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        minHeight: "100dvh",
        display: "flex",
        flexDirection: "column",
        background: "#F5F4F1",
        color: "#1A1B1A",
        fontFamily: "'Hanken Grotesk', system-ui, sans-serif",
      }}
    >
      <header
        style={{
          padding: "22px",
          borderBottom: "1px solid rgba(0,0,0,.08)",
        }}
      >
        <div style={{ maxWidth: 760, margin: "0 auto", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <Link href="/reserver" style={{ font: "400 24px 'Marcellus', serif", color: "#1A1B1A", textDecoration: "none" }}>
            {site.name}
          </Link>
          <Link href="/reserver" style={{ font: "500 13px 'Hanken Grotesk'", color: "#4E6E8C", textDecoration: "none" }}>
            ‹ Retour à la réservation
          </Link>
        </div>
      </header>
      <main style={{ flex: 1, padding: "40px 22px" }}>
        <article style={{ maxWidth: 760, margin: "0 auto" }}>{children}</article>
      </main>
      <SiteFooter />
    </div>
  );
}
