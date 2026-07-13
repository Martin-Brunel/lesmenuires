-- Explicit marketing permission and a permanent opposition mechanism.
-- Existing contacts are deliberately not opted in.

alter table customer
  add column marketing_consent boolean not null default false,
  add column marketing_consented_at timestamptz,
  add column marketing_consent_source text,
  add column marketing_opted_out_at timestamptz,
  add column unsubscribe_token text not null default encode(gen_random_bytes(32), 'hex');

create unique index customer_unsubscribe_token_unique on customer(unsubscribe_token);

alter table email_campaign_recipient
  drop constraint email_campaign_recipient_status_check;
alter table email_campaign_recipient
  add constraint email_campaign_recipient_status_check
  check (status in ('pending','processing','sent','failed'));

alter table email_campaign_recipient
  add column error text,
  add column processing_at timestamptz;
