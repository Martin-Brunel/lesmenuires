import type { MetadataRoute } from "next";

// En prod, le front et l'API partagent le domaine public (routés par Caddy),
// donc NEXT_PUBLIC_API_URL vaut aussi l'URL du site. NEXT_PUBLIC_SITE_URL permet
// de surcharger si un jour les domaines divergent.
const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  "http://localhost:3000";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: `${SITE_URL}/`, changeFrequency: "weekly", priority: 1 },
    { url: `${SITE_URL}/reserver`, changeFrequency: "daily", priority: 0.9 },
  ];
}
