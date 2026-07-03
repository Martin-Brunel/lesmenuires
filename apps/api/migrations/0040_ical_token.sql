-- Flux iCal du calendrier (sync Airbnb/Booking/Google Agenda) : jeton
-- capability par propriété, créé paresseusement quand l'admin demande l'URL.
alter table property add column ical_token text unique;
