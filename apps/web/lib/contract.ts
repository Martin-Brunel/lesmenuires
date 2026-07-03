// Texte canonique du contrat de location saisonnière. Source unique partagée par
// les deux funnels (desktop/mobile) — le client signe exactement le même texte quel
// que soit l'appareil — et envoyée au serveur à la signature pour archivage (preuve
// du texte exact accepté, pas seulement d'un numéro de version).
//
// Bilingue : le client signe dans la langue de son parcours. Le gabarit
// personnalisé (Éditorial → Contrat) renvoyé par l'API est déjà dans la bonne
// langue quand une traduction existe ; à défaut, texte canonique ci-dessous.

import type { Locale } from "@/lib/i18n";

export type ContractParams = {
  propertyName: string;
  locationLabel: string;
  cautionCents: number;
  capacity: number;
  /** Identité du bailleur (Éditorial → Propriétaire) ; clause générique si vide. */
  ownerName?: string;
  ownerAddress?: string;
  /** Gabarit personnalisé (Éditorial → Contrat). Vide = texte canonique
   *  ci-dessous. Variables : {{bailleur}}, {{nom}}, {{localisation}},
   *  {{capacite}}, {{caution}}. */
  template?: string;
};

const euros = (cents: number, locale: Locale) => {
  const v = Math.round(cents / 100).toLocaleString(locale === "fr" ? "fr-FR" : "en-GB");
  return locale === "fr" ? `${v} €` : `€${v}`;
};

export function contractText(p: ContractParams, locale: Locale = "fr"): string {
  const bailleur =
    locale === "fr"
      ? p.ownerName?.trim()
        ? `${p.ownerName.trim()}${p.ownerAddress?.trim() ? `, demeurant ${p.ownerAddress.trim()}` : ""}, propriétaire de ${p.propertyName}`
        : `le propriétaire de ${p.propertyName}`
      : p.ownerName?.trim()
        ? `${p.ownerName.trim()}${p.ownerAddress?.trim() ? `, residing at ${p.ownerAddress.trim()}` : ""}, owner of ${p.propertyName}`
        : `the owner of ${p.propertyName}`;
  const tpl = p.template?.trim();
  if (tpl) {
    return tpl
      .replaceAll("{{bailleur}}", bailleur)
      .replaceAll("{{nom}}", p.propertyName)
      .replaceAll("{{localisation}}", p.locationLabel)
      .replaceAll("{{capacite}}", String(p.capacity))
      .replaceAll("{{caution}}", euros(p.cautionCents, locale));
  }
  if (locale === "en") {
    return [
      `Between ${bailleur}, hereinafter "the Lessor", and the undersigned, hereinafter "the Tenant". The purpose of this contract is the furnished seasonal rental located in ${p.locationLabel}, for the period stated in the booking summary.`,
      `The Tenant undertakes to occupy the premises peacefully, with a maximum of ${p.capacity} guests, and to return the accommodation in good condition. The deposit paid upon signature constitutes a firm booking. The balance is charged two weeks before arrival. A security deposit of ${euros(p.cautionCents, locale)} is requested as a guarantee: no amount is blocked or charged — the registered card would only be charged in case of damage recorded at the check-out inspection. Any cancellation is governed by the general terms appended to this contract.`,
    ].join("\n\n");
  }
  return [
    `Entre ${bailleur}, ci-après « le Bailleur », et le signataire, ci-après « le Preneur ». Le présent contrat a pour objet la location meublée à usage saisonnier située à ${p.locationLabel}, pour la période indiquée dans le récapitulatif.`,
    `Le Preneur s'engage à occuper les lieux paisiblement, à hauteur de ${p.capacity} personnes maximum, et à restituer le logement en bon état. L'acompte versé à la signature vaut réservation ferme. Le solde est prélevé deux semaines avant l'arrivée. Une caution de ${euros(p.cautionCents, locale)} est demandée à titre de garantie : aucun montant n'est bloqué ni débité — la carte enregistrée ne serait débitée qu'en cas de dégâts constatés à l'état des lieux de sortie. Toute annulation est régie par les conditions générales annexées au présent contrat.`,
  ].join("\n\n");
}
