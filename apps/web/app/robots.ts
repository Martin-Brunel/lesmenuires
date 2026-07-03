import type { MetadataRoute } from "next";

// Même résolution d'URL que le sitemap : front et API partagent le domaine public
// en prod (routés par Caddy) ; NEXT_PUBLIC_SITE_URL surcharge si divergence.
const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  "http://localhost:3000";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // Zones privées / techniques : back-office, espace client, API, liens
      // capability (contrat signé, dépôt d'avis).
      disallow: [
        "/admin",
        "/espace",
        "/api",
        "/contrat",
        "/avis",
        "/en/espace",
        "/en/contrat",
        "/en/avis",
      ],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
