-- Saisons (hiver). Une propriété a une ou plusieurs saisons ; le site public
-- n'affiche que la saison active. Les semaines appartiennent à une saison et
-- peuvent référencer un palier tarifaire (basse / haute / vacances…).

create table season (
  id          uuid primary key default gen_random_uuid(),
  property_id uuid not null references property(id) on delete cascade,
  name        text not null,
  start_date  date not null,
  end_date    date not null,
  is_active   boolean not null default false,
  rate_tiers  jsonb not null default '[]'::jsonb,
  position    int not null default 0,
  created_at  timestamptz not null default now()
);

create index season_property_idx on season(property_id);

alter table availability_week
  add column season_id uuid references season(id) on delete set null,
  add column tier_key  text;

-- Saison par défaut + rattachement des semaines existantes.
insert into season (property_id, name, start_date, end_date, is_active, rate_tiers, position)
select id, 'Hiver 2025 – 2026', date '2025-12-06', date '2026-05-02', true,
       '[{"key":"basse","label":"Basse saison","priceCents":99000},
         {"key":"haute","label":"Haute saison","priceCents":129000},
         {"key":"vacances","label":"Vacances scolaires","priceCents":169000}]'::jsonb,
       0
from property where slug = 'ladret';

update availability_week aw
set season_id = s.id
from season s
join property p on p.id = s.property_id
where aw.property_id = p.id and p.slug = 'ladret';
