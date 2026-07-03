-- Multilangue intégral (fr canonique + en) :
--  - contenus éditoriaux traduits en jsonb ({"en": {"description": "...", ...}})
--    sur property et product — le français reste dans les colonnes existantes ;
--  - langue du client (customer.locale) captée au funnel, pilote la langue des
--    e-mails transactionnels et la redirection du lien magique ;
--  - overrides d'e-mails système par langue (kind, locale) — les overrides
--    existants restent français.

alter table property add column translations jsonb not null default '{}'::jsonb;
alter table product  add column translations jsonb not null default '{}'::jsonb;

alter table customer add column locale text not null default 'fr'
  check (locale in ('fr', 'en'));

alter table email_template_override
  add column locale text not null default 'fr'
  check (locale in ('fr', 'en'));
alter table email_template_override drop constraint email_template_override_pkey;
alter table email_template_override add primary key (kind, locale);
