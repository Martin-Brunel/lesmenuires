-- Journal des e-mails transactionnels : traçabilité complète du dossier de
-- réservation (envoi, id Resend, délivrance, ouverture, échec). Alimenté à
-- l'envoi ; enrichi par le webhook Resend (delivered/opened/bounced).

create table email_log (
  id           uuid primary key default gen_random_uuid(),
  booking_id   uuid references booking(id) on delete set null,
  recipient    text not null,
  kind         text not null,               -- welcome, magic_link, balance_paid, ...
  subject      text not null,
  provider_id  text,                        -- id de l'e-mail chez Resend
  status       text not null default 'queued', -- sent | delivered | opened | bounced | complained | failed
  error        text,
  created_at   timestamptz not null default now(),
  sent_at      timestamptz,
  delivered_at timestamptz,
  opened_at    timestamptz
);

create index email_log_booking_idx on email_log (booking_id);
create index email_log_provider_idx on email_log (provider_id);
