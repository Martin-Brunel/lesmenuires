-- Les libellés de semaine stockés n'affichaient pas l'année (« 26 déc — 02 jan »),
-- ce qui prête à confusion dès qu'une saison chevauche deux années civiles.
-- Reprise de toutes les semaines existantes : les libellés sont recalculés avec
-- l'année, dans le même format que la génération Rust (admin.rs::range_label).

with mois as (
  select array['jan','fév','mars','avr','mai','juin','juil','août','sept','oct','nov','déc'] as abbr,
         array['janvier','février','mars','avril','mai','juin','juillet','août',
               'septembre','octobre','novembre','décembre'] as full
)
update availability_week w
set range_label = case
      when extract(year from w.start_date) <> extract(year from w.end_date) then
        lpad(extract(day from w.start_date)::text, 2, '0') || ' ' ||
        m.abbr[extract(month from w.start_date)::int] || ' ' ||
        extract(year from w.start_date)::text || ' — ' ||
        lpad(extract(day from w.end_date)::text, 2, '0') || ' ' ||
        m.abbr[extract(month from w.end_date)::int] || ' ' ||
        extract(year from w.end_date)::text
      when extract(month from w.start_date) = extract(month from w.end_date) then
        lpad(extract(day from w.start_date)::text, 2, '0') || ' — ' ||
        lpad(extract(day from w.end_date)::text, 2, '0') || ' ' ||
        m.abbr[extract(month from w.end_date)::int] || ' ' ||
        extract(year from w.end_date)::text
      else
        lpad(extract(day from w.start_date)::text, 2, '0') || ' ' ||
        m.abbr[extract(month from w.start_date)::int] || ' — ' ||
        lpad(extract(day from w.end_date)::text, 2, '0') || ' ' ||
        m.abbr[extract(month from w.end_date)::int] || ' ' ||
        extract(year from w.end_date)::text
    end,
    arrival_label = 'samedi ' || extract(day from w.start_date)::text || ' ' ||
        m.full[extract(month from w.start_date)::int] || ' ' ||
        extract(year from w.start_date)::text,
    arrival_short = 'sam. ' || extract(day from w.start_date)::text || ' ' ||
        m.abbr[extract(month from w.start_date)::int] || ' ' ||
        extract(year from w.start_date)::text,
    depart_short = 'sam. ' || extract(day from w.end_date)::text || ' ' ||
        m.abbr[extract(month from w.end_date)::int] || ' ' ||
        extract(year from w.end_date)::text
from mois m;

-- Les lignes de dossier figent « Location · <libellé> » à la création : on les
-- aligne sur les libellés repris (factures/quittances plus claires).
update booking_line bl
set label = 'Location · ' || aw.range_label
from booking b
join availability_week aw on aw.id = b.week_id
where bl.booking_id = b.id and bl.label like 'Location ·%';
