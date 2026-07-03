// Central site & legal configuration.
//
// The legal identity (éditeur, hébergeur, contact) is CLIENT data. Fill the real
// values below or override them at build time via the NEXT_PUBLIC_* env vars — the
// LMNP loueur must provide name, postal address and contact e-mail; SIRET is
// optional (LMNP sans SIRET pour l'instant, cf. plan). Placeholders are marked
// « à compléter » so an incomplete deployment is obvious rather than silently wrong.

const env = (k: string, fallback: string) =>
  (process.env[k] && process.env[k]!.trim()) || fallback;

export const site = {
  name: env("NEXT_PUBLIC_SITE_NAME", "L'Adret"),
  // Localisation du bien (résidence Les Ménuires, vallée des Belleville / 3 Vallées).
  location: env("NEXT_PUBLIC_LOCATION", "Les Ménuires"),
  contactEmail: env("NEXT_PUBLIC_CONTACT_EMAIL", "contact@example.fr"),

  // ---- Éditeur (art. 6 LCEN) — à compléter par le loueur ----
  editor: {
    name: env("NEXT_PUBLIC_EDITOR_NAME", "[À compléter : nom / raison sociale du loueur]"),
    status: env("NEXT_PUBLIC_EDITOR_STATUS", "Loueur en meublé non professionnel (LMNP)"),
    address: env("NEXT_PUBLIC_EDITOR_ADDRESS", "[À compléter : adresse postale]"),
    siret: env("NEXT_PUBLIC_EDITOR_SIRET", ""), // vide = non affiché (LMNP sans SIRET)
    email: env("NEXT_PUBLIC_CONTACT_EMAIL", "contact@example.fr"),
    phone: env("NEXT_PUBLIC_EDITOR_PHONE", ""),
  },

  // ---- Hébergeur (art. 6 LCEN) ----
  host: {
    name: env("NEXT_PUBLIC_HOST_NAME", "[À compléter : hébergeur du site]"),
    address: env("NEXT_PUBLIC_HOST_ADDRESS", "[À compléter : adresse de l'hébergeur]"),
  },

  // Dernière mise à jour des textes légaux (affichée sur les pages).
  legalUpdatedAt: env("NEXT_PUBLIC_LEGAL_DATE", "2026-07-01"),
} as const;

/** True while the legal identity still holds placeholder values. */
export const legalIncomplete = site.editor.name.startsWith("[À compléter");

/** Version of the contract/CGV text presented in the funnel. Bump when the
 *  contract wording changes so each booking records which version was signed. */
// Bump à chaque évolution du texte canonique (lib/contract.ts).
// 2026-07-03.1 : version anglaise du texte canonique (multilangue).
export const CONTRACT_VERSION = "2026-07-03.1";
