-- Activation globale du site anglais.

alter table property
  add column english_enabled boolean not null default true;
