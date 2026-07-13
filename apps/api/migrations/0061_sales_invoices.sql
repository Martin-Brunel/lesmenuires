-- Factures clients numérotées et figées. Les snapshots garantissent qu'une
-- modification ultérieure du dossier/contact ne réécrit jamais un document émis.
create table sales_invoice_counter (
  year       integer primary key,
  last_value integer not null check (last_value >= 0)
);

create table sales_invoice (
  id                uuid primary key default gen_random_uuid(),
  booking_id        uuid not null references booking(id) on delete restrict,
  kind              text not null default 'invoice'
                    check (kind in ('invoice', 'credit_note')),
  number            text not null unique,
  issued_at         timestamptz not null default now(),
  seller_snapshot   jsonb not null,
  customer_snapshot jsonb not null,
  stay_snapshot     jsonb not null,
  lines_snapshot    jsonb not null,
  payment_snapshot  jsonb not null,
  total_cents       bigint not null check (total_cents >= 0),
  parent_invoice_id uuid references sales_invoice(id) on delete restrict,
  created_by        uuid references admin_user(id) on delete set null,
  created_at        timestamptz not null default now()
);

create unique index sales_invoice_one_original_per_booking
  on sales_invoice(booking_id) where kind = 'invoice';
create index sales_invoice_booking_idx on sales_invoice(booking_id, issued_at);

comment on table sales_invoice is
  'Documents de vente immuables : toute donnée affichée provient des snapshots.';
