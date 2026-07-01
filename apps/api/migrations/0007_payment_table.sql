-- Journal des transactions de paiement (une ligne par opération Stripe/mock).

create table payment (
  id                    uuid primary key default gen_random_uuid(),
  booking_id            uuid not null references booking(id) on delete cascade,
  type                  text not null,   -- deposit | balance | caution_auth | caution_capture | refund
  provider              text not null,
  provider_intent_id    text,
  amount_cents          bigint not null,
  captured_amount_cents bigint,
  status                text not null default 'pending',
  raw                   jsonb,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index payment_booking_idx on payment(booking_id);
