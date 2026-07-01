import type { Metadata } from "next";
import { Prose } from "@/components/Prose";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: `Mentions légales — ${site.name}`,
  robots: { index: true, follow: true },
};

const frDate = (iso: string) =>
  new Date(iso + "T12:00:00").toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

export default function MentionsLegales() {
  const { editor, host } = site;
  return (
    <Prose>
      <h1>Mentions légales</h1>
      <p className="updated">Dernière mise à jour : {frDate(site.legalUpdatedAt)}</p>

      <h2>Éditeur du site</h2>
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
