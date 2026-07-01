-- Comptes d'administration + sessions (back-office).

create table admin_user (
  id            uuid primary key default gen_random_uuid(),
  email         text unique not null,
  password_hash text not null,
  display_name  text not null default '',
  created_at    timestamptz not null default now()
);

create table admin_session (
  token         text primary key,
  admin_user_id uuid not null references admin_user(id) on delete cascade,
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null
);

create index admin_session_expires_idx on admin_session(expires_at);
