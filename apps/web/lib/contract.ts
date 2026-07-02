// Texte canonique du contrat de location saisonnière. Source unique partagée par
// les deux funnels (desktop/mobile) — le client signe exactement le même texte quel
// que soit l'appareil — et envoyée au serveur à la signature pour archivage (preuve
// du texte exact accepté, pas seulement d'un numéro de version).

export type ContractParams = {
  propertyName: string;
  locationLabel: string;
  cautionCents: number;
  capacity: number;
};

const euros = (cents: number) =>
  `${Math.round(cents / 100).toLocaleString("fr-FR")} €`;

export function contractText(p: ContractParams): string {
  return [
    `Entre le propriétaire de ${p.propertyName}, ci-après « le Bailleur », et le signataire, ci-après « le Preneur ». Le présent contrat a pour objet la location meublée à usage saisonnier située à ${p.locationLabel}, pour la période indiquée dans le récapitulatif.`,
    `Le Preneur s'engage à occuper les lieux paisiblement, à hauteur de ${p.capacity} personnes maximum, et à restituer le logement en bon état. L'acompte versé à la signature vaut réservation ferme. Le solde est prélevé deux semaines avant l'arrivée. Une caution de ${euros(p.cautionCents)} est demandée à titre de garantie : aucun montant n'est bloqué ni débité — la carte enregistrée ne serait débitée qu'en cas de dégâts constatés à l'état des lieux de sortie. Toute annulation est régie par les conditions générales annexées au présent contrat.`,
  ].join("\n\n");
}
