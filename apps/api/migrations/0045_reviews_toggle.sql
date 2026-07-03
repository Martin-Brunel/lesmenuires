-- Interrupteur global des avis voyageurs : quand il est coupé, le site public
-- n'affiche plus les avis et les demandes d'avis (automatiques ou manuelles)
-- sont suspendues. Les avis déjà reçus restent en base et dans l'admin ; les
-- liens d'avis déjà envoyés restent utilisables.

alter table property
  add column reviews_enabled boolean not null default true;
