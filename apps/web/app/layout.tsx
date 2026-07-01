import type { Metadata } from "next";
import "./globals.css";

const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "L'Adret — Réservez votre semaine au Grand-Bornand",
  description:
    "Chalet de famille plein sud sur la chaîne des Aravis. Réservez votre semaine en autonomie : tarifs, prestations, signature électronique et acompte en ligne.",
  openGraph: {
    title: "L'Adret — Réservez votre semaine au Grand-Bornand",
    description:
      "Chalet de famille plein sud sur la chaîne des Aravis. Réservez votre semaine en autonomie.",
    type: "website",
    locale: "fr_FR",
  },
  // Les espaces privés ne doivent pas être indexés.
  robots: { index: true, follow: true },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="fr">
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
      </head>
      <body>{children}</body>
    </html>
  );
}
