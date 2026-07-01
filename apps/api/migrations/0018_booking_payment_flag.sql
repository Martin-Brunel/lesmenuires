-- Admin-attention flag set by webhook events that Stripe raises out-of-band
-- (refund or dispute initiated from the Stripe dashboard, or a chargeback). A
-- flagged booking is skipped by the scheduler's off-session charges so we never
-- debit the balance/caution of a booking that is being refunded or disputed.

alter table booking
  add column payment_flag text,
  add column flagged_at timestamptz;

alter table booking
  add constraint booking_payment_flag_check
  check (payment_flag is null or payment_flag in ('refunded_externally', 'disputed'));
