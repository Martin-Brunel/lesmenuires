-- Gestion des comptes admin : le premier compte créé devient superadmin
-- (peut créer/supprimer des sous-comptes) ; journal d'audit « qui fait quoi »
-- alimenté automatiquement par le middleware sur chaque action mutante.

alter table admin_user add column is_super boolean not null default false;
update admin_user set is_super = true
where id = (select id from admin_user order by created_at limit 1);

create table admin_audit (
  id         uuid primary key default gen_random_uuid(),
  admin_id   uuid references admin_user(id) on delete set null,
  admin_name text not null default '',
  method     text not null,
  path       text not null,
  created_at timestamptz not null default now()
);
create index admin_audit_created_idx on admin_audit (created_at desc);
