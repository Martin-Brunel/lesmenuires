-- Seed de démonstration : la propriété L'Adret et le calendrier février 2026
-- (mêmes données que le prototype front).

insert into property
  (slug, name, location_label, description, surface_label, capacity, bedrooms, specs_label, highlight_label, hero_seed, deposit_pct, caution_cents)
values
  ('ladret', 'L''Adret', 'Le Grand-Bornand · 1 280 m',
   'Chalet de famille au calme, plein sud sur la chaîne des Aravis. Poêle à bois, grandes baies vitrées et sauna après le ski. Pensé pour les familles et les couples qui cherchent l''essentiel, en mieux — à cinq minutes des pistes et du village.',
   '95 m²', 6, 3, '95 m² · 6 voyageurs · 3 chambres · Sauna & cheminée', 'Sauna & cheminée',
   'adret-chalet-a', 30, 80000);

insert into availability_week
  (property_id, start_date, end_date, range_label, sub_label, price_cents, status, arrival_label, arrival_short, depart_short, balance_due_label, position)
select p.id, d.start_date, d.end_date, d.range_label, d.sub_label, d.price_cents, d.status,
       d.arrival_label, d.arrival_short, d.depart_short, d.balance_due_label, d.position
from property p,
(values
  ('2026-01-31'::date, '2026-02-07'::date, '31 jan — 07 fév',  'Samedi → samedi',     119000, 'available', 'samedi 31 janvier', 'sam. 31 jan', 'sam. 7 fév',  '1 janvier 2026',  0),
  ('2026-02-07',       '2026-02-14',       '07 — 14 fév',      'Vacances scolaires',  169000, 'available', 'samedi 7 février',  'sam. 7 fév',  'sam. 14 fév', '8 janvier 2026',  1),
  ('2026-02-14',       '2026-02-21',       '14 — 21 fév',      'Complet',             169000, 'booked',    '',                  '—',           '—',          '',                2),
  ('2026-02-21',       '2026-02-28',       '21 — 28 fév',      'Samedi → samedi',     129000, 'available', 'samedi 21 février', 'sam. 21 fév', 'sam. 28 fév', '22 janvier 2026', 3),
  ('2026-02-28',       '2026-03-07',       '28 fév — 07 mars', 'Samedi → samedi',      99000, 'available', 'samedi 28 février', 'sam. 28 fév', 'sam. 7 mars', '29 janvier 2026', 4)
) as d(start_date, end_date, range_label, sub_label, price_cents, status, arrival_label, arrival_short, depart_short, balance_due_label, position)
where p.slug = 'ladret';

insert into product (key, label, description, price_cents, position) values
  ('draps',  'Draps & linge de maison', 'Lits faits à l''arrivée, linge de toilette fourni', 4500, 0),
  ('menage', 'Ménage fin de séjour',    'Vous repartez sans rien faire',                     9000, 1),
  ('bois',   'Pack montagne',           'Bois, allumage & café d''accueil',                  6000, 2),
  ('bebe',   'Lit & chaise bébé',       'Sur demande, selon disponibilité',                     0, 3);
