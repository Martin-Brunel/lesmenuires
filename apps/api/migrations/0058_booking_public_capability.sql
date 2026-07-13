-- A booking reference is a human-facing identifier, not an authorization secret.
-- Public cart operations use a 256-bit capability instead.

alter table booking
  add column public_token text not null default encode(gen_random_bytes(32), 'hex');

create unique index booking_public_token_unique on booking(public_token);
