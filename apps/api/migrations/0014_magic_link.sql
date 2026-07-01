-- Liens magiques : jeton court à usage unique, échangé contre une session
-- client (reconnexion à l'espace depuis un e-mail).
create table magic_link (
  token       text primary key,
  customer_id uuid not null references customer(id) on delete cascade,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  used_at     timestamptz
);

create index magic_link_expires_idx on magic_link(expires_at);
