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
      // Zones privées / techniques : back-office, espace client, API.
      disallow: ["/admin", "/espace", "/api"],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
