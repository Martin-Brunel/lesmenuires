-- Transactionnels éditables pilotés par événements du séjour.
-- Un « transactionnel » = un e-mail rattaché à un événement fixe (réservation,
-- arrivée, départ, annulation), envoyé à J+offset (offset négatif = avant),
-- conditionnel au canal (site / manuel / tous), au contenu éditable (variables
-- {{prenom}}, {{reference}}, {{semaine}}, {{arrivee}}, {{depart}}, {{total}},
-- {{acompte}}, {{solde}}, {{acces}}).

create table email_automation (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  event       text not null check (event in ('reservation','arrival','departure','cancellation')),
  offset_days int  not null default 0 check (offset_days between -60 and 365),
  channel     text not null default 'all' check (channel in ('all','online','manual')),
  subject     text not null,
  body        text not null,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Un envoi par (automatisation, dossier) — idempotence du moteur.
create table email_automation_send (
  automation_id uuid not null references email_automation(id) on delete cascade,
  booking_id    uuid not null references booking(id) on delete cascade,
  sent_at       timestamptz not null default now(),
  primary key (automation_id, booking_id)
);

-- Le rappel avant arrivée codé en dur (migration 0029) devient la première
-- automatisation éditable ; on reprend les envois déjà effectués puis on
-- retire l'ancien flag.
insert into email_automation (name, event, offset_days, subject, body) values (
  'Rappel avant arrivée',
  'arrival',
  -7,
  'Votre séjour à L''Adret approche',
  E'Bonjour {{prenom}},\n\nVotre séjour à L''Adret approche : arrivée {{arrivee}} (semaine du {{semaine}}), réservation {{reference}}.\n\n{{acces}}\n\nVous retrouvez toutes les informations de votre séjour dans votre espace.'
);

insert into email_automation_send (automation_id, booking_id, sent_at)
select (select id from email_automation where name = 'Rappel avant arrivée' limit 1),
       b.id, b.arrival_reminder_sent_at
from booking b
where b.arrival_reminder_sent_at is not null;

alter table booking drop column arrival_reminder_sent_at;
