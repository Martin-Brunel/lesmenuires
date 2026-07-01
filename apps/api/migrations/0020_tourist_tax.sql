-- Taxe de séjour : montant par adulte et par nuit (mineurs exonérés), réglable en
-- back-office. 0 = non appliquée. Le montant collecté est figé sur la réservation
-- (comme les autres montants) pour la comptabilité et la déclaration à la commune.

alter table property
  add column tourist_tax_cents bigint not null default 0; -- par adulte et par nuit

alter table booking
  add column tourist_tax_cents bigint not null default 0; -- montant total collecté
