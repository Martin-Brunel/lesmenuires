import Link from "next/link";
import { SiteFooter } from "@/components/SiteFooter";
import { site } from "@/lib/site";
import { getDict, localePath } from "@/lib/i18n";
import { requestLocale } from "@/lib/i18n/server";
import { LangSwitcher } from "@/components/LangSwitcher";

export default async function LegalLayout({ children }: { children: React.ReactNode }) {
  const locale = await requestLocale();
  const t = getDict(locale);
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
        <div style={{ maxWidth: 760, margin: "0 auto", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
          <Link href={localePath(locale, "/reserver")} style={{ font: "400 24px 'Marcellus', serif", color: "#1A1B1A", textDecoration: "none" }}>
            {site.name}
          </Link>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <LangSwitcher compact />
            <Link href={localePath(locale, "/reserver")} style={{ font: "500 13px 'Hanken Grotesk'", color: "#4E6E8C", textDecoration: "none" }}>
              ‹ {t.nav.backToBooking}
            </Link>
          </div>
        </div>
      </header>
      <main style={{ flex: 1, padding: "40px 22px" }}>
        <article style={{ maxWidth: 760, margin: "0 auto" }}>{children}</article>
      </main>
      <SiteFooter />
    </div>
  );
}
