-- Pré-notification du prélèvement du solde : e-mail envoyé quelques jours avant
-- le prélèvement automatique (J-14) pour laisser le client vérifier sa carte ou
-- régler en avance (réduit les échecs SCA). Flag pour n'envoyer qu'une fois.

alter table booking
  add column balance_prenotified_at timestamptz;
