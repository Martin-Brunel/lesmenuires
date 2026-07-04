import Link from "next/link";
import { OpenChatLink } from "@/components/OpenChatLink";
import { site } from "@/lib/site";
import { getDict, localePath } from "@/lib/i18n";
import { requestLocale } from "@/lib/i18n/server";

/** Shared footer with the mandatory legal links (LCEN / RGPD / consumer law). */
export async function SiteFooter() {
  const locale = await requestLocale();
  const t = getDict(locale);
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
          <Link href={localePath(locale, "/mentions-legales")} style={linkStyle}>{t.footer.legalNotice}</Link>
          <Link href={localePath(locale, "/cgv")} style={linkStyle}>{t.footer.terms}</Link>
          <Link href={localePath(locale, "/confidentialite")} style={linkStyle}>{t.footer.privacy}</Link>
          <Link href={localePath(locale, "/cookies")} style={linkStyle}>{t.footer.cookies}</Link>
          <Link href={localePath(locale, "/espace")} style={linkStyle}>{t.nav.mySpace}</Link>
          <OpenChatLink />
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
        {t.legal.allRightsReserved(year, site.name)}
      </div>
    </footer>
  );
}
