import type { Metadata } from "next";
import { Prose } from "@/components/Prose";
import { site } from "@/lib/site";
import { getDict, localePath, type Locale } from "@/lib/i18n";
import { hreflangAlternates, requestLocale } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await requestLocale();
  return {
    title: getDict(locale).legal.privacyTitle(site.name),
    robots: { index: true, follow: true },
    alternates: hreflangAlternates("/confidentialite"),
  };
}

const legalDate = (iso: string, locale: Locale) =>
  new Date(iso + "T12:00:00").toLocaleDateString(locale === "fr" ? "fr-FR" : "en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

export default async function Confidentialite() {
  const locale = await requestLocale();
  const t = getDict(locale);

  if (locale === "en") {
    return (
      <Prose>
        <h1>Privacy policy</h1>
        <p className="updated">{t.legal.lastUpdated(legalDate(site.legalUpdatedAt, locale))}</p>

        <p>
          {site.name} attaches great importance to the protection of your personal data. This
          policy describes the data collected, its purposes and your rights, in accordance with
          the General Data Protection Regulation (GDPR).
        </p>

        <h2>Data controller</h2>
        <p>
          The data controller is the site publisher (see the{" "}
          <a href={localePath(locale, "/mentions-legales")}>legal notice</a>). Contact:{" "}
          <a href={`mailto:${site.contactEmail}`}>{site.contactEmail}</a>.
        </p>

        <h2>Data collected</h2>
        <ul>
          <li>Identity and contact details: surname, first name, e-mail, phone, postal address.</li>
          <li>Booking data: selected stay, extras, amounts, contract signature.</li>
          <li>
            Payment data: processed directly by our provider Stripe; we never store your card
            number.
          </li>
          <li>Technical session data (sign-in cookie for your account).</li>
        </ul>

        <h2>Purposes and legal bases</h2>
        <ul>
          <li>
            Management of bookings and payments — <strong>performance of the contract</strong>.
          </li>
          <li>
            Sending transactional e-mails (confirmation, payment dates, cancellation) —{" "}
            <strong>performance of the contract</strong>.
          </li>
          <li>
            Reminder for an unfinished cart — <strong>legitimate interest</strong>, with the
            possibility to object at any time.
          </li>
          <li>
            Compliance with accounting and tax obligations — <strong>legal obligation</strong>.
          </li>
        </ul>

        <h2>Recipients</h2>
        <p>
          Your data is intended for the lessor and their technical processors acting on
          instruction: <strong>Stripe</strong> (payment), <strong>Resend</strong> (e-mail
          delivery). It is never sold.
        </p>

        <h2>Retention period</h2>
        <p>
          Booking data is kept for the duration of the contractual relationship and then archived
          in accordance with legal obligations (notably accounting). Expired session tokens and
          sign-in links are automatically purged.
        </p>

        <h2>Your rights</h2>
        <p>
          You have a right of access, rectification, erasure, restriction, objection and
          portability. To exercise them, write to{" "}
          <a href={`mailto:${site.contactEmail}`}>{site.contactEmail}</a>. You may also lodge a
          complaint with the CNIL, the French data protection authority (www.cnil.fr).
        </p>

        <h2>Cookies</h2>
        <p>
          The use of cookies and trackers is detailed on the{" "}
          <a href={localePath(locale, "/cookies")}>Cookies</a> page.
        </p>
      </Prose>
    );
  }

  return (
    <Prose>
      <h1>Politique de confidentialité</h1>
      <p className="updated">{t.legal.lastUpdated(legalDate(site.legalUpdatedAt, locale))}</p>

      <p>
        {site.name} accorde une grande importance à la protection de vos données personnelles. Cette
        politique décrit les données collectées, leurs finalités et vos droits, conformément au
        Règlement général sur la protection des données (RGPD).
      </p>

      <h2>Responsable du traitement</h2>
      <p>
        Le responsable du traitement est l’éditeur du site (voir les{" "}
        <a href="/mentions-legales">mentions légales</a>). Contact :{" "}
        <a href={`mailto:${site.contactEmail}`}>{site.contactEmail}</a>.
      </p>

      <h2>Données collectées</h2>
      <ul>
        <li>Identité et coordonnées : nom, prénom, e-mail, téléphone, adresse postale.</li>
        <li>Données de réservation : séjour choisi, prestations, montants, signature du contrat.</li>
        <li>
          Données de paiement : traitées directement par notre prestataire Stripe ; nous ne stockons
          jamais votre numéro de carte.
        </li>
        <li>Données techniques de session (cookie de connexion à votre espace).</li>
      </ul>

      <h2>Finalités et bases légales</h2>
      <ul>
        <li>
          Gestion des réservations et des paiements — <strong>exécution du contrat</strong>.
        </li>
        <li>
          Envoi d’e-mails transactionnels (confirmation, échéances, annulation) —{" "}
          <strong>exécution du contrat</strong>.
        </li>
        <li>
          Relance d’un panier non finalisé — <strong>intérêt légitime</strong>, avec possibilité de
          s’y opposer à tout moment.
        </li>
        <li>Respect des obligations comptables et fiscales — <strong>obligation légale</strong>.</li>
      </ul>

      <h2>Destinataires</h2>
      <p>
        Vos données sont destinées au bailleur et à ses sous-traitants techniques agissant sur
        instruction : <strong>Stripe</strong> (paiement), <strong>Resend</strong> (envoi d’e-mails).
        Elles ne sont jamais vendues.
      </p>

      <h2>Durée de conservation</h2>
      <p>
        Les données de réservation sont conservées le temps de la relation contractuelle puis
        archivées conformément aux obligations légales (notamment comptables). Les jetons de session
        et liens de connexion expirés sont automatiquement purgés.
      </p>

      <h2>Vos droits</h2>
      <p>
        Vous disposez d’un droit d’accès, de rectification, d’effacement, de limitation, d’opposition
        et de portabilité. Pour les exercer, écrivez à{" "}
        <a href={`mailto:${site.contactEmail}`}>{site.contactEmail}</a>. Vous pouvez également
        introduire une réclamation auprès de la CNIL (www.cnil.fr).
      </p>

      <h2>Cookies</h2>
      <p>
        L’usage des cookies et traceurs est détaillé sur la page{" "}
        <a href="/cookies">Cookies</a>.
      </p>
    </Prose>
  );
}
