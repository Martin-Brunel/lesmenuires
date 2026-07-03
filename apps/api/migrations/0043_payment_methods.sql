-- Moyens de règlement paramétrables pour la réservation en ligne.
--
-- CB (Stripe) = flux actuel : contrat signé + acompte encaissé → confirmée.
-- Chèque / virement = la réservation passe en 'pending_payment' : la semaine
-- est tenue (option), le client reçoit les instructions de règlement, et la
-- réservation ne devient définitive que lorsque l'admin pointe l'acompte
-- comme encaissé (mark-paid). Sinon l'admin annule et la semaine se libère.

alter table property
  add column pay_card_enabled       boolean not null default true,
  add column pay_cheque_enabled     boolean not null default false,
  add column pay_virement_enabled   boolean not null default false,
  -- Instructions affichées au client (et envoyées par e-mail) : ordre et
  -- adresse pour le chèque, IBAN/BIC pour le virement.
  add column instructions_cheque    text not null default '',
  add column instructions_virement  text not null default '';

-- Nouveau statut : réservation en ligne en attente de règlement hors CB.
alter table booking drop constraint if exists booking_status_check;
alter table booking
  add constraint booking_status_check
  check (status in ('cart', 'pending_payment', 'confirmed', 'balance_paid',
                    'cancelled', 'expired'));

-- Une option chèque/virement tient la semaine : elle compte comme réservation
-- active dans le filet anti-double-réservation.
drop index if exists booking_one_active_per_week;
create unique index booking_one_active_per_week
  on booking (week_id)
  where status in ('pending_payment', 'confirmed', 'balance_paid');
