-- Choix d'affichage/comptage de la taxe de séjour : incluse dans le total du
-- dossier (l'acompte porte alors sur le total taxe comprise) ou exclue (défaut :
-- total = locatif, taxe ajoutée en totalité au solde). Le montant total encaissé
-- est identique dans les deux cas.

alter table property
  add column tourist_tax_included boolean not null default false;
