import type { Metadata } from "next";
import { Prose } from "@/components/Prose";
import { site } from "@/lib/site";
import { getDict } from "@/lib/i18n";
import { hreflangAlternates, requestLocale } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await requestLocale();
  return {
    title: getDict(locale).legal.cookiesTitle(site.name),
    robots: { index: true, follow: true },
    alternates: hreflangAlternates("/cookies"),
  };
}

export default async function Cookies() {
  const locale = await requestLocale();

  if (locale === "en") {
    return (
      <Prose>
        <h1>Cookie policy</h1>

        <p>
          This site uses the minimum number of cookies required for it to work. We do not use any
          advertising cookies or third-party audience measurement without your consent.
        </p>

        <h2>Strictly necessary cookies</h2>
        <ul>
          <li>
            <strong>Session cookie</strong> (sign-in to your guest account): required to keep you
            signed in. Exempt from consent.
          </li>
        </ul>

        <h2>Cookies set during payment</h2>
        <p>
          When you proceed to payment, our provider <strong>Stripe</strong> loads its secure
          module, which may set technical cookies required for fraud prevention and the proper
          completion of the transaction. These cookies are only loaded when you open the payment
          form, never while simply browsing.
        </p>

        <h2>Your choice</h2>
        <p>
          No non-essential tracker is set without your consent. You can configure your browser to
          refuse cookies at any time; payment may then be degraded.
        </p>

        <p>
          For any question: <a href={`mailto:${site.contactEmail}`}>{site.contactEmail}</a>.
        </p>
      </Prose>
    );
  }

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
