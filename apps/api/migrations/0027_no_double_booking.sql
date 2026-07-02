-- Filet de sécurité anti-double-réservation au niveau base : deux réservations
-- actives (confirmée ou soldée) ne peuvent jamais tenir la même semaine. La
-- logique applicative (try_claim_week / claim manuel) l'empêche déjà en amont ;
-- cet index unique partiel garantit l'invariant même si un futur chemin l'oubliait.
-- Les statuts cart/expired/cancelled ne sont pas contraints (plusieurs paniers
-- concurrents sur une même semaine restent normaux tant qu'aucun n'est confirmé).

create unique index booking_one_active_per_week
  on booking (week_id)
  where status in ('confirmed', 'balance_paid');
