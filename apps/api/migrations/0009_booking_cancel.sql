-- Annulation de réservation. Règle métier : l'acompte est conservé, le solde
-- n'est pas prélevé (le planificateur ignore les réservations 'cancelled') ;
-- si l'annulation intervient après le paiement du solde, aucun remboursement.

alter table booking
  add column if not exists cancelled_at  timestamptz,
  add column if not exists cancel_reason text;
