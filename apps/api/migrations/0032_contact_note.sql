-- Notes internes au niveau contact (CRM) : annoter un client ou un prospect
-- indépendamment d'un dossier de réservation.
create table contact_note (
  id          uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customer(id) on delete cascade,
  body        text not null,
  author      text,
  created_at  timestamptz not null default now()
);
create index contact_note_customer_idx on contact_note (customer_id);
