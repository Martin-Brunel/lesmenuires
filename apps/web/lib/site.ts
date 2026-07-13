// Central site & legal configuration.
//
// The legal identity (éditeur, hébergeur, contact) is CLIENT data. Fill the real
// values below or override them at build time via the NEXT_PUBLIC_* env vars — the
// LMNP loueur must provide name, postal address and contact e-mail; SIRET is
// required for issued invoices. Placeholders are marked
// « à compléter » so an incomplete deployment is obvious rather than silently wrong.

// Accès STATIQUES à process.env.NEXT_PUBLIC_* obligatoires : le bundler ne
// remplace que les références littérales à la compilation — une lecture par clé
// dynamique (process.env[k]) resterait vide au runtime, côté client comme SSR.
const val = (v: string | undefined, fallback: string) => (v && v.trim()) || fallback;

export const site = {
  name: val(process.env.NEXT_PUBLIC_SITE_NAME, "L'Adret"),
  // Localisation du bien (résidence Les Ménuires, vallée des Belleville / 3 Vallées).
  location: val(process.env.NEXT_PUBLIC_LOCATION, "Les Ménuires"),
  contactEmail: val(process.env.NEXT_PUBLIC_CONTACT_EMAIL, "contact@example.fr"),

  // ---- Éditeur (art. 6 LCEN) — à compléter par le loueur ----
  editor: {
    name: val(process.env.NEXT_PUBLIC_EDITOR_NAME, "[À compléter : nom / raison sociale du loueur]"),
    status: val(process.env.NEXT_PUBLIC_EDITOR_STATUS, "Loueur en meublé non professionnel (LMNP)"),
    address: val(process.env.NEXT_PUBLIC_EDITOR_ADDRESS, "[À compléter : adresse postale]"),
    siret: val(process.env.NEXT_PUBLIC_EDITOR_SIRET, ""),
    email: val(process.env.NEXT_PUBLIC_CONTACT_EMAIL, "contact@example.fr"),
    phone: val(process.env.NEXT_PUBLIC_EDITOR_PHONE, ""),
  },

  // ---- Hébergeur du SITE (art. 6 LCEN) — la société d'hébergement web, pas le loueur ----
  host: {
    name: val(process.env.NEXT_PUBLIC_HOST_NAME, "[À compléter : hébergeur du site]"),
    address: val(process.env.NEXT_PUBLIC_HOST_ADDRESS, "[À compléter : adresse de l'hébergeur]"),
  },

  // ---- Médiateur de la consommation (art. L.612-1 C. conso.) ----
  mediator: {
    name: val(process.env.NEXT_PUBLIC_MEDIATOR_NAME, "[À compléter : médiateur de la consommation]"),
    address: val(process.env.NEXT_PUBLIC_MEDIATOR_ADDRESS, "[À compléter : adresse du médiateur]"),
    website: val(process.env.NEXT_PUBLIC_MEDIATOR_WEBSITE, ""),
  },

  // Dernière mise à jour des textes légaux (affichée sur les pages).
  legalUpdatedAt: val(process.env.NEXT_PUBLIC_LEGAL_DATE, "2026-07-13"),
} as const;

/** True while the legal identity still holds placeholder values. */
export const legalIncomplete =
  site.editor.name.startsWith("[À compléter") ||
  site.editor.address.startsWith("[À compléter") ||
  site.host.name.startsWith("[À compléter") ||
  site.mediator.name.startsWith("[À compléter");

/** Version of the contract/CGV text presented in the funnel. Bump when the
 *  contract wording changes so each booking records which version was signed. */
// Bump à chaque évolution du texte canonique (lib/contract.ts).
// 2026-07-03.1 : version anglaise du texte canonique (multilangue).
export const CONTRACT_VERSION = "2026-07-03.1";
