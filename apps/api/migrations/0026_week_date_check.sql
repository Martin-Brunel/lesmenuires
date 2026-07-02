-- Cohérence des semaines : la fin doit être après le début. Auto-répare les
-- éventuelles lignes incohérentes (fin ≤ début → fin = début + 7) avant de poser
-- la contrainte, puis empêche structurellement toute future incohérence.

update availability_week set end_date = start_date + 7 where end_date <= start_date;

alter table availability_week
  add constraint availability_week_dates_check check (end_date > start_date);
