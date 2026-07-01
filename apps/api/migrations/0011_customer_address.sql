-- Adresse postale du client (contrat de location).
alter table customer
  add column if not exists address_line text not null default '',
  add column if not exists postal_code  text not null default '',
  add column if not exists city         text not null default '',
  add column if not exists country      text not null default '';
