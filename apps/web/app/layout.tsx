import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "L'Adret — Réservez votre semaine au Grand-Bornand",
  description:
    "Chalet de famille plein sud sur la chaîne des Aravis. Réservez votre semaine en autonomie : tarifs, prestations, signature électronique et acompte en ligne.",
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
