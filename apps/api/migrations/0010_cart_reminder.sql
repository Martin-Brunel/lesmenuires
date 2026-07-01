-- Marqueur de relance de panier abandonné.
alter table booking
  add column if not exists cart_reminder_sent_at timestamptz;
