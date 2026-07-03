// Helpers i18n côté serveur (server components / generateMetadata).

import { headers } from "next/headers";
import { DEFAULT_LOCALE, isLocale, localePath, type Locale } from "./index";

/** Locale de la requête, posée par le middleware (x-locale). fr par défaut
 *  (couvre aussi /admin, hors périmètre du middleware). */
export async function requestLocale(): Promise<Locale> {
  const h = (await headers()).get("x-locale");
  return isLocale(h) ? h : DEFAULT_LOCALE;
}

/** Alternates hreflang d'une page publique pour ses deux langues. */
export function hreflangAlternates(path: string) {
  return {
    languages: {
      fr: localePath("fr", path),
      en: localePath("en", path),
      "x-default": localePath("fr", path),
    },
  };
}
