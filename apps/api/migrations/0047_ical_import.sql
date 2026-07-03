-- Import iCal entrant : calendriers externes (Airbnb, Booking, …) dont les
-- évènements bloquent automatiquement les semaines correspondantes, pour
-- éviter les doubles réservations multi-canaux (le flux sortant existe déjà,
-- ceci est le sens inverse).

create table ical_feed (
  id             uuid primary key default gen_random_uuid(),
  property_id    uuid not null references property(id) on delete cascade,
  name           text not null,
  url            text not null,
  last_synced_at timestamptz,
  -- Dernière erreur de synchronisation (ou avertissement de conflit) ; null si OK.
  last_error     text,
  created_at     timestamptz not null default now()
);

-- Source du blocage : renseignée quand la semaine a été bloquée par la synchro
-- d'un flux (et déblocable automatiquement quand l'évènement disparaît).
-- Null = blocage manuel de l'exploitant, jamais touché par la synchro.
alter table availability_week
  add column blocked_by_feed uuid references ical_feed(id) on delete set null;
