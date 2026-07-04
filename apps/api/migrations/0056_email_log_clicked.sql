-- Suivi des clics dans les e-mails (webhook Resend email.clicked) + statut
-- « différé » (email.delivery_delayed). Statuts possibles désormais :
-- queued | sent | delayed | delivered | opened | clicked | bounced | complained | failed

alter table email_log add column clicked_at timestamptz;
