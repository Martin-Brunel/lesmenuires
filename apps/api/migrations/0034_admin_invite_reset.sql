-- Invitation par e-mail (plus de mot de passe provisoire) et mot de passe
-- oublié. password_hash null = compte invité qui n'a pas encore défini son
-- mot de passe (connexion impossible). Jetons à usage unique.

alter table admin_user alter column password_hash drop not null;

create table admin_password_token (
  token         text primary key,
  admin_user_id uuid not null references admin_user(id) on delete cascade,
  kind          text not null check (kind in ('invite','reset')),
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null,
  used_at       timestamptz
);
create index admin_password_token_user_idx on admin_password_token (admin_user_id);
