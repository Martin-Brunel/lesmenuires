-- Sessions client (espace authentifié). Créées en fin de parcours de
-- réservation ; connexion ultérieure par lien magique (à venir avec l'e-mail).

create table customer_session (
  token       text primary key,
  customer_id uuid not null references customer(id) on delete cascade,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null
);

create index customer_session_expires_idx on customer_session(expires_at);
