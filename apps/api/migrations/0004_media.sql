-- Photos du logement (galerie). Les fichiers vivent sur disque (MEDIA_DIR),
-- la base ne stocke que le nom de fichier + métadonnées.

create table property_media (
  id          uuid primary key default gen_random_uuid(),
  property_id uuid not null references property(id) on delete cascade,
  filename    text not null,
  alt         text not null default '',
  position    int  not null default 0,
  created_at  timestamptz not null default now()
);

create index property_media_property_idx on property_media(property_id, position);
