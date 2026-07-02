-- Notes internes de dossier (CRM) : commentaires horodatés que l'exploitant
-- ajoute à une réservation. Apparaissent dans la timeline d'événements.

create table booking_note (
  id         uuid primary key default gen_random_uuid(),
  booking_id uuid not null references booking(id) on delete cascade,
  body       text not null,
  author     text,
  created_at timestamptz not null default now()
);

create index booking_note_booking_idx on booking_note (booking_id, created_at);
