-- Références de la carte enregistrée (provider-neutres) pour rejouer le solde
-- et la caution off-session.

alter table booking
  add column provider_customer_id        text,
  add column provider_payment_method_id  text;
