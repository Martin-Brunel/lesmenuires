-- Délai minimal (en jours) entre la réservation en ligne et le début du séjour.
-- 0 = comportement historique : réservation possible jusqu'au jour d'arrivée.
-- Ne concerne que le tunnel public (et le chatbot) — l'admin reste libre.
alter table property
    add column min_booking_lead_days int not null default 0
    check (min_booking_lead_days between 0 and 365);
