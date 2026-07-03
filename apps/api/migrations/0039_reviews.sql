-- Avis voyageurs : demandé automatiquement après le départ (lien capability
-- review_token), déposé par le client, puis modéré/publié par l'admin sur le
-- site public (avec réponse éventuelle de l'hôte).
create table review (
    id uuid primary key default gen_random_uuid(),
    booking_id uuid not null unique references booking(id) on delete cascade,
    rating int not null check (rating between 1 and 5),
    comment text not null default '',
    author_name text not null default '',
    published boolean not null default false,
    admin_reply text,
    submitted_at timestamptz not null default now(),
    created_at timestamptz not null default now()
);

alter table booking add column review_token text unique;
alter table booking add column review_requested_at timestamptz;
