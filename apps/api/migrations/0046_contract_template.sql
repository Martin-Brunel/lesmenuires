-- Gabarit du contrat de location éditable dans l'admin (Éditorial → Contrat).
-- Vide = texte canonique par défaut (apps/web/lib/contract.ts). Variables
-- rendues côté front : {{bailleur}}, {{nom}}, {{localisation}}, {{capacite}},
-- {{caution}}. Le texte EXACT signé par chaque client reste archivé sur la
-- réservation (booking.contract_text, migration 0028) : modifier le gabarit
-- n'altère jamais les contrats déjà signés.

alter table property
  add column contract_template text not null default '';
