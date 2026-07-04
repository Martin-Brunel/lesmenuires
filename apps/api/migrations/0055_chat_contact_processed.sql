-- Suivi des messages laissés à l'équipe via le chat : « à traiter » tant que
-- contact_processed_at est nul.
alter table chat_conversation
  add column contact_processed_at timestamptz;
