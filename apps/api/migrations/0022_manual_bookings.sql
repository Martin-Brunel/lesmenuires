-- Réservations manuelles (prises hors ligne par téléphone/mail) : échéances
-- pointées à la main, règlement par chèque ou virement, et caution par chèque
-- physique. Distinguées des réservations en ligne pour que le scheduler et les
-- e-mails automatiques les ignorent.

alter table booking
  add column channel text not null default 'online',   -- 'online' | 'manual'
  add column payment_method text,                       -- manuel : 'cheque' | 'virement'
  add column caution_method text,                       -- 'card' (en ligne) | 'cheque' (manuel)
  add column admin_notes text;

alter table booking
  add constraint booking_channel_check check (channel in ('online', 'manual'));

-- Moyen de règlement d'une ligne de paiement (null = ancien / carte en ligne).
alter table payment
  add column method text;
