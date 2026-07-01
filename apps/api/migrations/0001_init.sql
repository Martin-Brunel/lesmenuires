create extension if not exists pgcrypto;

-- Propriété (lot). Modèle générique, prêt pour le multi-lots.
create table property (
  id              uuid primary key default gen_random_uuid(),
  slug            text unique not null,
  name            text not null,
  location_label  text not null,
  description     text not null,
  surface_label   text not null,
  capacity        int  not null,
  bedrooms        int  not null,
  specs_label     text not null,
  highlight_label text not null,
  hero_seed       text not null default 'adret-chalet-a',
  deposit_pct     int  not null default 30,
  caution_cents   bigint not null default 80000,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- Disponibilités à la semaine (samedi -> samedi).
create table availability_week (
  id                uuid primary key default gen_random_uuid(),
  property_id       uuid not null references property(id) on delete cascade,
  start_date        date not null,
  end_date          date not null,
  range_label       text not null,
  sub_label         text not null,
  price_cents       bigint not null,
  status            text not null default 'available'
                      check (status in ('available','booked','blocked')),
  arrival_label     text not null default '',
  arrival_short     text not null default '',
  depart_short      text not null default '',
  balance_due_label text not null default '',
  position          int  not null default 0,
  unique (property_id, start_date)
);

-- Prestations complémentaires (draps, ménage, etc.).
create table product (
  id          uuid primary key default gen_random_uuid(),
  key         text unique not null,
  label       text not null,
  description text not null,
  price_cents bigint not null,
  active      boolean not null default true,
  position    int not null default 0
);

create table customer (
  id         uuid primary key default gen_random_uuid(),
  email      text not null,
  first_name text not null default '',
  last_name  text not null default '',
  phone      text not null default '',
  created_at timestamptz not null default now()
);

-- Réservation (panier -> ... -> clôturée). Montants figés côté serveur.
create table booking (
  id                 uuid primary key default gen_random_uuid(),
  reference          text unique not null,
  property_id        uuid not null references property(id),
  customer_id        uuid references customer(id),
  week_id            uuid not null references availability_week(id),
  status             text not null default 'cart',
  adults             int not null default 2,
  children           int not null default 0,
  week_price_cents   bigint not null,
  extras_total_cents bigint not null,
  total_cents        bigint not null,
  deposit_pct        int not null,
  deposit_cents      bigint not null,
  balance_cents      bigint not null,
  caution_cents      bigint not null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create table booking_line (
  id               uuid primary key default gen_random_uuid(),
  booking_id       uuid not null references booking(id) on delete cascade,
  kind             text not null,            -- 'accommodation' | 'product'
  product_id       uuid references product(id),
  label            text not null,
  quantity         int not null default 1,
  unit_price_cents bigint not null,
  total_cents      bigint not null,
  position         int not null default 0
);

create index booking_property_idx on booking(property_id);
create index booking_line_booking_idx on booking_line(booking_id);
