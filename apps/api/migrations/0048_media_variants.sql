-- Variantes redimensionnées des photos (perf front : srcset / tailles adaptées).
-- `widths` liste les largeurs générées pour ce média (fichiers
-- <stem>-w<width>.jpg à côté de l'original) ; '{}' = pas encore générées,
-- le backfill au démarrage de l'API s'en charge.
alter table property_media
  add column widths int4[] not null default '{}';
