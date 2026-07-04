import type { MetadataRoute } from "next";
import { localePath, LOCALES } from "@/lib/i18n";
import { getPublicSettings } from "@/lib/api";

// En prod, le front et l'API partagent le domaine public (routés par Caddy),
// donc NEXT_PUBLIC_API_URL vaut aussi l'URL du site. NEXT_PUBLIC_SITE_URL permet
// de surcharger si un jour les domaines divergent.
const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  "http://localhost:3000";

const PAGES: { path: string; changeFrequency: "daily" | "weekly" | "yearly"; priority: number }[] = [
  { path: "/", changeFrequency: "weekly", priority: 1 },
  { path: "/reserver", changeFrequency: "daily", priority: 0.9 },
  { path: "/mentions-legales", changeFrequency: "yearly", priority: 0.2 },
  { path: "/cgv", changeFrequency: "yearly", priority: 0.3 },
  { path: "/confidentialite", changeFrequency: "yearly", priority: 0.2 },
  { path: "/cookies", changeFrequency: "yearly", priority: 0.2 },
];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const settings = await getPublicSettings();
  const locales = settings.englishEnabled ? LOCALES : (["fr"] as const);
  return PAGES.flatMap((p) =>
    locales.map((locale) => ({
      url: `${SITE_URL}${localePath(locale, p.path)}`,
      changeFrequency: p.changeFrequency,
      priority: locale === "fr" ? p.priority : p.priority * 0.8,
      alternates: {
        languages: Object.fromEntries(
          locales.map((l) => [l, `${SITE_URL}${localePath(l, p.path)}`]),
        ),
      },
    })),
  );
}
