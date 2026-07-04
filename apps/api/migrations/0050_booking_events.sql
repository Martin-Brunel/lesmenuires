-- Historique structuré par dossier : actions admin attribuées et évènements
-- externes (notamment statuts Resend) affichés dans la timeline réservation.

create table booking_event (
  id             uuid primary key default gen_random_uuid(),
  booking_id     uuid not null references booking(id) on delete cascade,
  kind           text not null,
  title          text not null,
  detail         text,
  actor_admin_id uuid references admin_user(id) on delete set null,
  actor_name     text,
  email_log_id   uuid references email_log(id) on delete set null,
  created_at     timestamptz not null default now()
);

create index booking_event_booking_idx on booking_event (booking_id, created_at desc);
create index booking_event_email_idx on booking_event (email_log_id);
create unique index booking_event_email_kind_unique
  on booking_event (email_log_id, kind)
  where email_log_id is not null;

insert into booking_event (booking_id, kind, title, detail, email_log_id, created_at)
select booking_id, 'email.delivered', 'E-mail délivré', subject || ' · ' || recipient, id, delivered_at
from email_log
where booking_id is not null and delivered_at is not null
on conflict (email_log_id, kind) where email_log_id is not null do nothing;

insert into booking_event (booking_id, kind, title, detail, email_log_id, created_at)
select booking_id, 'email.opened', 'E-mail ouvert', subject || ' · ' || recipient, id, opened_at
from email_log
where booking_id is not null and opened_at is not null
on conflict (email_log_id, kind) where email_log_id is not null do nothing;

insert into booking_event (booking_id, kind, title, detail, email_log_id, created_at)
select booking_id, 'email.bounced', 'E-mail en échec', subject || ' · ' || recipient, id, created_at
from email_log
where booking_id is not null and status = 'bounced'
on conflict (email_log_id, kind) where email_log_id is not null do nothing;

insert into booking_event (booking_id, kind, title, detail, email_log_id, created_at)
select booking_id, 'email.complained', 'Plainte e-mail', subject || ' · ' || recipient, id, created_at
from email_log
where booking_id is not null and status = 'complained'
on conflict (email_log_id, kind) where email_log_id is not null do nothing;
