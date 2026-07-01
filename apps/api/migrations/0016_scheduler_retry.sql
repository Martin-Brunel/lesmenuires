-- Track automatic-payment attempts so the scheduler can: (a) vary the Stripe
-- idempotency key per genuine retry, (b) surface failures to the admin, and
-- (c) notify the customer once on a definitive failure (dunning).

alter table booking
  add column balance_attempts int not null default 0,
  add column balance_last_error text,
  add column balance_failed_notified_at timestamptz,
  add column caution_attempts int not null default 0,
  add column caution_last_error text,
  add column caution_failed_notified_at timestamptz;
