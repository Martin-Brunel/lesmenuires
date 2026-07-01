-- Flux de paiement : références d'intents + jalons sur la réservation.
-- Les montants (deposit/balance/caution) existent déjà sur booking ; on ajoute
-- les identifiants de transaction et les horodatages d'étape.

alter table booking
  add column provider               text,
  add column deposit_intent_id      text,
  add column deposit_paid_at        timestamptz,
  add column balance_intent_id      text,
  add column balance_paid_at        timestamptz,
  add column caution_intent_id      text,
  add column caution_authorized_at  timestamptz,
  add column caution_captured_cents bigint,
  add column caution_released_at    timestamptz;
