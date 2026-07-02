-- Personnalisation des e-mails système (confirmation, solde, incidents,
-- relance panier, annulation, contrat…) : un override par type ; en son
-- absence, le gabarit par défaut du code s'applique. Supprimer l'override
-- rétablit le défaut.
create table email_template_override (
  kind       text primary key,
  subject    text not null,
  body       text not null,
  updated_at timestamptz not null default now()
);
