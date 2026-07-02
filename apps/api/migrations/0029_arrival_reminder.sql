-- Rappel avant arrivée : e-mail J-7 (récap séjour + instructions d'accès),
-- envoyé une seule fois par le scheduler.
alter table booking add column arrival_reminder_sent_at timestamptz;
