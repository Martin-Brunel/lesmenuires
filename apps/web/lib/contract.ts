// Texte canonique du contrat de location saisonnière. Source unique partagée par
// les deux funnels (desktop/mobile) — le client signe exactement le même texte quel
// que soit l'appareil — et envoyée au serveur à la signature pour archivage (preuve
// du texte exact accepté, pas seulement d'un numéro de version).

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

const euros = (cents: number) =>
  `${Math.round(cents / 100).toLocaleString("fr-FR")} €`;

export function contractText(p: ContractParams): string {
  const bailleur = p.ownerName?.trim()
    ? `${p.ownerName.trim()}${p.ownerAddress?.trim() ? `, demeurant ${p.ownerAddress.trim()}` : ""}, propriétaire de ${p.propertyName}`
    : `le propriétaire de ${p.propertyName}`;
  const tpl = p.template?.trim();
  if (tpl) {
    return tpl
      .replaceAll("{{bailleur}}", bailleur)
      .replaceAll("{{nom}}", p.propertyName)
      .replaceAll("{{localisation}}", p.locationLabel)
      .replaceAll("{{capacite}}", String(p.capacity))
      .replaceAll("{{caution}}", euros(p.cautionCents));
  }
  return [
    `Entre ${bailleur}, ci-après « le Bailleur », et le signataire, ci-après « le Preneur ». Le présent contrat a pour objet la location meublée à usage saisonnier située à ${p.locationLabel}, pour la période indiquée dans le récapitulatif.`,
    `Le Preneur s'engage à occuper les lieux paisiblement, à hauteur de ${p.capacity} personnes maximum, et à restituer le logement en bon état. L'acompte versé à la signature vaut réservation ferme. Le solde est prélevé deux semaines avant l'arrivée. Une caution de ${euros(p.cautionCents)} est demandée à titre de garantie : aucun montant n'est bloqué ni débité — la carte enregistrée ne serait débitée qu'en cas de dégâts constatés à l'état des lieux de sortie. Toute annulation est régie par les conditions générales annexées au présent contrat.`,
  ].join("\n\n");
}
