import type { Metadata } from "next";
import { Prose } from "@/components/Prose";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: `Conditions de location — ${site.name}`,
  robots: { index: true, follow: true },
};

const frDate = (iso: string) =>
  new Date(iso + "T12:00:00").toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

export default function Cgv() {
  return (
    <Prose>
      <h1>Conditions générales de location</h1>
      <p className="updated">Dernière mise à jour : {frDate(site.legalUpdatedAt)}</p>

      <p>
        Les présentes conditions régissent la location saisonnière meublée du logement{" "}
        {site.name}, situé à {site.location}, réservée en ligne. La signature du contrat lors de la
        réservation vaut acceptation de ces conditions.
      </p>

      <h2>1. Réservation et paiement</h2>
      <p>
        La réservation est ferme après signature électronique du contrat et versement de l’acompte.
        Le solde est prélevé automatiquement <strong>deux semaines avant l’arrivée</strong> sur le
        moyen de paiement enregistré. Une <strong>caution</strong> est demandée à titre de garantie :
        aucun montant n’est bloqué ni prélevé, la carte enregistrée n’étant débitée qu’en cas de
        dégâts constatés (voir article 5).
      </p>

      <h2>2. Acompte</h2>
      <p>
        La somme versée à la réservation constitue un <strong>acompte</strong> : elle engage
        fermement les deux parties. En cas d’annulation par le preneur, l’acompte reste acquis au
        bailleur dans les conditions prévues à l’article 4.
      </p>

      <h2>3. Prix et taxe de séjour</h2>
      <p>
        Les prix sont indiqués en euros, toutes taxes comprises. Le bailleur relève du régime de la
        franchise en base de TVA (article 293 B du CGI) : TVA non applicable. La{" "}
        <strong>taxe de séjour</strong>, le cas échéant, est collectée pour le compte de la commune
        et s’ajoute au prix du séjour ; son montant est précisé avant le paiement.
      </p>

      <h2>4. Annulation</h2>
      <p>
        Toute annulation doit être notifiée par écrit. Sauf conditions particulières indiquées lors
        de la réservation :
      </p>
      <ul>
        <li>
          <strong>Plus de 30 jours avant l’arrivée</strong> : annulation gratuite, les sommes déjà
          réglées sont intégralement remboursées.
        </li>
        <li>
          <strong>Moins de 30 jours avant l’arrivée</strong> : l’acompte reste acquis au bailleur ;
          le solde n’est pas prélevé s’il ne l’a pas encore été.
        </li>
      </ul>
      <p>
        Le bailleur peut, à sa discrétion, procéder à un remboursement complémentaire. En cas
        d’annulation du fait du bailleur, l’intégralité des sommes versées est restituée.
      </p>

      <h2>5. Caution</h2>
      <p>
        La caution garantit les éventuels dommages et manquements constatés à l’état des lieux de
        sortie. Le moyen de paiement enregistré lors de la réservation reste en garantie : aucun
        montant n’est bloqué. En cas de dégâts justifiés, le montant correspondant (dans la limite de
        la caution) est débité sur ce moyen de paiement ; à défaut, aucun prélèvement n’est effectué.
      </p>

      <h2>6. Occupation</h2>
      <p>
        Le logement est loué pour un usage d’habitation temporaire, dans la limite de la capacité
        d’accueil indiquée. Le preneur s’engage à en jouir paisiblement, à respecter le règlement
        intérieur et à restituer le logement en bon état.
      </p>

      <h2>7. Droit de rétractation</h2>
      <p>
        Conformément à l’article L.221-28 12° du Code de la consommation, les prestations
        d’hébergement fournies à une date déterminée <strong>ne bénéficient pas</strong> du délai de
        rétractation de quatorze jours.
      </p>

      <h2>8. Réclamations et médiation</h2>
      <p>
        Toute réclamation peut être adressée à{" "}
        <a href={`mailto:${site.contactEmail}`}>{site.contactEmail}</a>. À défaut de résolution,
        vous pouvez recourir gratuitement au médiateur de la consommation (article L.612-1 du Code
        de la consommation).
      </p>
    </Prose>
  );
}
