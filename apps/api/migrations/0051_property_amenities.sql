-- Équipements éditoriaux affichés sur le site public avec pictogrammes.

alter table property
  add column amenities jsonb not null default '[]'::jsonb;
