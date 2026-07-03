import type { Metadata } from "next";
import "./globals.css";
import { CookieBanner } from "@/components/CookieBanner";
import { I18nProvider } from "@/components/I18nProvider";
import { getDict } from "@/lib/i18n";
import { requestLocale } from "@/lib/i18n/server";
import { site } from "@/lib/site";

const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  "http://localhost:3000";

// Mesure d'audience self-hosted (Umami), activée seulement si configurée au
// build — voir lib/analytics.ts et DEPLOY.md « Mesure d'audience ».
const ANALYTICS_SRC = process.env.NEXT_PUBLIC_ANALYTICS_SRC ?? "";
const ANALYTICS_WEBSITE_ID = process.env.NEXT_PUBLIC_ANALYTICS_WEBSITE_ID ?? "";
const analyticsEnabled = ANALYTICS_SRC !== "" && ANALYTICS_WEBSITE_ID !== "";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await requestLocale();
  const t = getDict(locale);
  const title = t.meta.homeTitle(site.name, site.location);
  const description = t.meta.homeDescription(site.location);
  return {
    metadataBase: new URL(SITE_URL),
    title,
    description,
    openGraph: {
      title,
      description,
      type: "website",
      locale: locale === "fr" ? "fr_FR" : "en_GB",
    },
    robots: { index: true, follow: true },
  };
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const locale = await requestLocale();
  return (
    <html lang={locale}>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        {/* Direction « Premium éditorial » : Marcellus (titres) + Hanken Grotesk (texte). */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Marcellus&family=Hanken+Grotesk:wght@400;500;600;700&display=swap"
        />
        {analyticsEnabled && (
          // Umami : script léger, sans cookie (pas de consentement requis),
          // données hébergées sur notre propre infra.
          <script defer src={ANALYTICS_SRC} data-website-id={ANALYTICS_WEBSITE_ID} />
        )}
      </head>
      <body>
        <I18nProvider locale={locale}>
          {children}
          <CookieBanner />
        </I18nProvider>
      </body>
    </html>
  );
}
