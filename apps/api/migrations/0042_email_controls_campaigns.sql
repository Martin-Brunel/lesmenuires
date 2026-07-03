-- Contrôle des e-mails transactionnels automatiques + interrupteur de la
-- réservation en ligne + campagnes e-mails sur contacts filtrés.

-- Coupure par réservation : les e-mails automatiques (accueil, pré-notification
-- et reçu de solde, relances, demande d'avis, transactionnels personnalisés)
-- sont ignorés pour un dossier muet. Les envois manuels de l'admin restent
-- toujours possibles.
alter table booking
  add column emails_muted boolean not null default false;

-- Les réservations manuelles existantes étaient gérées hors ligne : on ne veut
-- pas qu'elles se mettent à recevoir des automatiques.
update booking set emails_muted = true where channel = 'manual';

-- Réglages globaux (portés par la propriété — plateforme mono-propriété).
alter table property
  add column transactional_emails_enabled boolean not null default true,
  add column online_booking_enabled       boolean not null default true;

-- Campagnes e-mails : ciblage par critères (jsonb), destinataires figés à la
-- création (snapshot — la liste n'évolue plus même si les contacts changent).
create table email_campaign (
  id              uuid primary key default gen_random_uuid(),
  subject         text not null,
  body            text not null,
  filters         jsonb not null default '{}',
  status          text not null default 'draft' check (status in ('draft','sent')),
  recipient_count int not null default 0,
  created_by      uuid references admin_user(id) on delete set null,
  created_at      timestamptz not null default now(),
  sent_at         timestamptz
);

create table email_campaign_recipient (
  id          uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references email_campaign(id) on delete cascade,
  customer_id uuid references customer(id) on delete set null,
  email       text not null,
  first_name  text not null default '',
  last_name   text not null default '',
  status      text not null default 'pending' check (status in ('pending','sent')),
  sent_at     timestamptz,
  unique (campaign_id, email)
);

create index email_campaign_recipient_campaign_idx on email_campaign_recipient(campaign_id);
