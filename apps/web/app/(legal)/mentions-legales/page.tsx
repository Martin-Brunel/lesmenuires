import type { Metadata } from "next";
import { Prose } from "@/components/Prose";
import { site } from "@/lib/site";
import { getDict, localePath, type Locale } from "@/lib/i18n";
import { hreflangAlternates, requestLocale } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await requestLocale();
  return {
    title: getDict(locale).legal.legalNoticeTitle(site.name),
    robots: { index: true, follow: true },
    alternates: hreflangAlternates("/mentions-legales"),
  };
}

const legalDate = (iso: string, locale: Locale) =>
  new Date(iso + "T12:00:00").toLocaleDateString(locale === "fr" ? "fr-FR" : "en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

export default async function MentionsLegales() {
  const locale = await requestLocale();
  const t = getDict(locale);
  const { editor, host } = site;
  const identity = (
    <p>
      <strong>{editor.name}</strong>
      <br />
      {editor.status}
      <br />
      {editor.address}
      <br />
      {editor.siret ? (
        <>
          SIRET : {editor.siret}
          <br />
        </>
      ) : null}
      Contact : <a href={`mailto:${editor.email}`}>{editor.email}</a>
      {editor.phone ? <> — {editor.phone}</> : null}
    </p>
  );

  if (locale === "en") {
    return (
      <Prose>
        <h1>Legal notice</h1>
        <p className="updated">{t.legal.lastUpdated(legalDate(site.legalUpdatedAt, locale))}</p>

        <h2>Site publisher</h2>
        {identity}

        <h2>Publication director</h2>
        <p>{editor.name}</p>

        <h2>Hosting provider</h2>
        <p>
          <strong>{host.name}</strong>
          <br />
          {host.address}
        </p>

        <h2>Intellectual property</h2>
        <p>
          All content on this site (texts, photographs, graphic elements) is protected by
          intellectual property law. Any reproduction without prior authorisation is prohibited.
        </p>

        <h2>Personal data</h2>
        <p>
          The processing of your personal data is described in our{" "}
          <a href={localePath(locale, "/confidentialite")}>privacy policy</a>. You have a right of
          access, rectification and erasure, which you can exercise at{" "}
          <a href={`mailto:${editor.email}`}>{editor.email}</a>.
        </p>

        <h2>Consumer mediation</h2>
        <p>
          In accordance with article L.612-1 of the French Consumer Code, in the event of an
          unresolved dispute, you may use a consumer mediator free of charge. The contact details
          of the competent mediator will be provided on request at the address above.
        </p>
      </Prose>
    );
  }

  return (
    <Prose>
      <h1>Mentions légales</h1>
      <p className="updated">{t.legal.lastUpdated(legalDate(site.legalUpdatedAt, locale))}</p>

      <h2>Éditeur du site</h2>
      {identity}

      <h2>Directeur de la publication</h2>
      <p>{editor.name}</p>

      <h2>Hébergeur</h2>
      <p>
        <strong>{host.name}</strong>
        <br />
        {host.address}
      </p>

      <h2>Propriété intellectuelle</h2>
      <p>
        L’ensemble des contenus (textes, photographies, éléments graphiques) présents sur ce site
        est protégé par le droit de la propriété intellectuelle. Toute reproduction sans
        autorisation préalable est interdite.
      </p>

      <h2>Données personnelles</h2>
      <p>
        Le traitement de vos données personnelles est décrit dans notre{" "}
        <a href="/confidentialite">politique de confidentialité</a>. Vous disposez d’un droit
        d’accès, de rectification et de suppression que vous pouvez exercer à l’adresse{" "}
        <a href={`mailto:${editor.email}`}>{editor.email}</a>.
      </p>

      <h2>Médiation de la consommation</h2>
      <p>
        Conformément à l’article L.612-1 du Code de la consommation, en cas de litige non résolu,
        vous pouvez recourir gratuitement à un médiateur de la consommation. Les coordonnées du
        médiateur compétent seront communiquées sur demande à l’adresse ci-dessus.
      </p>
    </Prose>
  );
}
