import type { Metadata } from "next";
import { Prose } from "@/components/Prose";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: `Cookies — ${site.name}`,
  robots: { index: true, follow: true },
};

export default function Cookies() {
  return (
    <Prose>
      <h1>Gestion des cookies</h1>

      <p>
        Ce site utilise le minimum de cookies nécessaires à son fonctionnement. Nous n’utilisons
        aucun cookie publicitaire ni de mesure d’audience tierce sans votre consentement.
      </p>

      <h2>Cookies strictement nécessaires</h2>
      <ul>
        <li>
          <strong>Cookie de session</strong> (connexion à votre espace client) : indispensable pour
          vous maintenir connecté. Exempté de consentement.
        </li>
      </ul>

      <h2>Cookies déposés lors du paiement</h2>
      <p>
        Lorsque vous procédez au paiement, notre prestataire <strong>Stripe</strong> charge son
        module sécurisé, qui peut déposer des cookies techniques nécessaires à la prévention de la
        fraude et au bon déroulement de la transaction. Ces cookies ne sont chargés qu’au moment où
        vous ouvrez le formulaire de paiement, jamais en simple navigation.
      </p>

      <h2>Votre choix</h2>
      <p>
        Aucun traceur non essentiel n’est déposé sans votre accord. Vous pouvez à tout moment
        configurer votre navigateur pour refuser les cookies ; le fonctionnement du paiement pourrait
        alors être dégradé.
      </p>

      <p>
        Pour toute question : <a href={`mailto:${site.contactEmail}`}>{site.contactEmail}</a>.
      </p>
    </Prose>
  );
}
