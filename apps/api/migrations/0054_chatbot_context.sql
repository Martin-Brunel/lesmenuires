-- Contexte libre du gestionnaire pour l'assistant IA (recommandations locales,
-- restaurants, cours de ski…) injecté dans le prompt de Léa.
alter table property
  add column chatbot_extra_context text not null default '';
