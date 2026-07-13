import type { Metadata } from "next";
import { Prose } from "@/components/Prose";
import { site } from "@/lib/site";
import { getDict, type Locale } from "@/lib/i18n";
import { hreflangAlternates, requestLocale } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await requestLocale();
  return {
    title: getDict(locale).legal.cgvTitle(site.name),
    robots: { index: true, follow: true },
    alternates: hreflangAlternates("/cgv"),
  };
}

const legalDate = (iso: string, locale: Locale) =>
  new Date(iso + "T12:00:00").toLocaleDateString(locale === "fr" ? "fr-FR" : "en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

export default async function Cgv() {
  const locale = await requestLocale();
  const t = getDict(locale);

  if (locale === "en") {
    return (
      <Prose>
        <h1>General rental terms</h1>
        <p className="updated">{t.legal.lastUpdated(legalDate(site.legalUpdatedAt, locale))}</p>

        <p>
          These terms govern the furnished seasonal rental of the accommodation {site.name},
          located in {site.location}, booked online. Signing the contract at the time of booking
          constitutes acceptance of these terms.
        </p>

        <h2>1. Booking and payment</h2>
        <p>
          The booking is firm after electronic signature of the contract and payment of the
          deposit. The balance is charged automatically <strong>two weeks before arrival</strong>{" "}
          on the registered payment method. A <strong>security deposit</strong> is requested as a
          guarantee: no amount is blocked or charged, the registered card is only debited in case
          of recorded damage (see article 5).
        </p>

        <h2>2. Deposit</h2>
        <p>
          The amount paid at booking constitutes a <strong>deposit</strong> (« acompte »): it
          firmly commits both parties. If the tenant cancels, the deposit remains with the lessor
          under the conditions set out in article 4.
        </p>

        <h2>3. Prices and tourist tax</h2>
        <p>
          Prices are shown in euros, all taxes included. The lessor benefits from the French VAT
          exemption scheme (article 293 B of the French Tax Code): VAT not applicable. The{" "}
          <strong>tourist tax</strong>, where applicable, is collected on behalf of the
          municipality and is added to the price of the stay; its amount is specified before
          payment.
        </p>

        <h2>4. Cancellation</h2>
        <p>
          Any cancellation must be notified in writing. Unless special conditions are indicated at
          the time of booking:
        </p>
        <ul>
          <li>
            <strong>More than 30 days before arrival</strong>: free cancellation, all amounts
            already paid are fully refunded.
          </li>
          <li>
            <strong>Less than 30 days before arrival</strong>: the deposit remains with the
            lessor; the balance is not charged if it has not yet been.
          </li>
        </ul>
        <p>
          The lessor may, at their discretion, grant an additional refund. If the lessor cancels,
          all amounts paid are returned in full.
        </p>

        <h2>5. Security deposit</h2>
        <p>
          The security deposit covers any damage and breaches recorded at the check-out
          inspection. The payment method registered at booking remains as a guarantee: no amount
          is blocked. In case of justified damage, the corresponding amount (up to the security
          deposit) is charged to that payment method; otherwise, nothing is charged.
        </p>

        <h2>6. Occupancy</h2>
        <p>
          The accommodation is rented for temporary residential use, within the stated capacity.
          The tenant undertakes to occupy it peacefully, to comply with the house rules and to
          return the accommodation in good condition.
        </p>

        <h2>7. Right of withdrawal</h2>
        <p>
          In accordance with article L.221-28 12° of the French Consumer Code, accommodation
          services provided on a specific date <strong>do not benefit</strong> from the
          fourteen-day withdrawal period.
        </p>

        <h2>8. Complaints and mediation</h2>
        <p>
          Any complaint may be sent to{" "}
          <a href={`mailto:${site.contactEmail}`}>{site.contactEmail}</a>. Failing resolution, you
          may use {site.mediator.name} free of charge (article L.612-1 of the French Consumer
          Code), {site.mediator.address}
          {site.mediator.website ? <> — <a href={site.mediator.website}>{site.mediator.website}</a></> : null}.
        </p>
      </Prose>
    );
  }

  return (
    <Prose>
      <h1>Conditions générales de location</h1>
      <p className="updated">{t.legal.lastUpdated(legalDate(site.legalUpdatedAt, locale))}</p>

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
        vous pouvez recourir gratuitement à {site.mediator.name} (article L.612-1 du Code
        de la consommation), {site.mediator.address}
        {site.mediator.website ? <> — <a href={site.mediator.website}>{site.mediator.website}</a></> : null}.
      </p>
    </Prose>
  );
}
