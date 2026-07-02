-- Identité du propriétaire (bailleur) : affichée dans les contrats et sur les
-- factures/quittances. Renseignée dans l'admin (Éditorial → Propriétaire).
alter table property
  add column owner_name    text not null default '',
  add column owner_address text not null default '',
  add column owner_phone   text not null default '',
  add column owner_email   text not null default '',
  add column owner_siret   text not null default '';
