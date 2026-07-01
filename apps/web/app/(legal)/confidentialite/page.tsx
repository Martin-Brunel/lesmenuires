import type { Metadata } from "next";
import { Prose } from "@/components/Prose";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: `Politique de confidentialité — ${site.name}`,
  robots: { index: true, follow: true },
};

const frDate = (iso: string) =>
  new Date(iso + "T12:00:00").toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

export default function Confidentialite() {
  return (
    <Prose>
      <h1>Politique de confidentialité</h1>
      <p className="updated">Dernière mise à jour : {frDate(site.legalUpdatedAt)}</p>

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
