-- Comptabilité en partie double : plan de comptes (PCG adapté LMNP), écritures
-- équilibrées débit/crédit (garanti par trigger différé), fournisseurs et
-- factures fournisseurs (charges externes).
--
-- Journaux : VE (ventes), AC (achats), BQ (banque/trésorerie), OD (opérations diverses).
-- Les écritures générées depuis les flux existants (booking/payment) portent un
-- couple (source_type, source_id) unique → synchronisation idempotente.

create table account (
  id         uuid primary key default gen_random_uuid(),
  code       text unique not null check (code ~ '^[1-8][0-9]{2,7}$'),
  name       text not null,
  -- Comptes seedés, référencés par code dans la génération automatique : ni
  -- suppression ni changement de code (le libellé reste modifiable).
  is_system  boolean not null default false,
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);

create table supplier (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null,
  email              text not null default '',
  phone              text not null default '',
  address            text not null default '',
  iban               text not null default '',
  notes              text not null default '',
  -- Compte de charge proposé par défaut à la saisie d'une facture.
  default_account_id uuid references account(id),
  is_active          boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create table ledger_entry (
  id          uuid primary key default gen_random_uuid(),
  journal     text not null check (journal in ('VE','AC','BQ','OD')),
  entry_date  date not null,
  -- Numéro de pièce séquentiel par journal et par année : VE-2026-0001.
  piece       text unique not null,
  label       text not null,
  -- Origine automatique (booking_invoice / payment / booking_cancel /
  -- supplier_invoice / supplier_payment) ; null = saisie manuelle.
  source_type text,
  source_id   text,
  -- Contre-passation : l'écriture X annulée par Y ↔ X.reversed_by = Y et
  -- Y.reverses = X. Une écriture comptable ne se supprime pas, elle s'extourne.
  reverses    uuid references ledger_entry(id),
  reversed_by uuid references ledger_entry(id),
  created_by  uuid references admin_user(id) on delete set null,
  created_at  timestamptz not null default now(),
  unique (source_type, source_id)
);

create index ledger_entry_date_idx on ledger_entry(entry_date);
create index ledger_entry_journal_idx on ledger_entry(journal);

create table ledger_line (
  id           uuid primary key default gen_random_uuid(),
  entry_id     uuid not null references ledger_entry(id) on delete cascade,
  account_id   uuid not null references account(id),
  label        text not null default '',
  debit_cents  bigint not null default 0 check (debit_cents >= 0),
  credit_cents bigint not null default 0 check (credit_cents >= 0),
  -- Une ligne est soit au débit, soit au crédit, jamais les deux ni aucune.
  check ((debit_cents = 0) <> (credit_cents = 0)),
  supplier_id  uuid references supplier(id),
  booking_id   uuid references booking(id) on delete set null,
  position     int not null default 0
);

create index ledger_line_entry_idx on ledger_line(entry_id);
create index ledger_line_account_idx on ledger_line(account_id);

-- Équilibre débit = crédit par écriture, vérifié en fin de transaction
-- (trigger contrainte différé : la saisie multi-lignes passe, une écriture
-- déséquilibrée fait échouer le commit).
create or replace function check_entry_balanced() returns trigger as $$
declare
  eid uuid;
  d bigint; c bigint; n int;
begin
  eid := coalesce(new.entry_id, old.entry_id);
  select coalesce(sum(debit_cents),0), coalesce(sum(credit_cents),0), count(*)
    into d, c, n from ledger_line where entry_id = eid;
  -- L'écriture peut avoir été supprimée en cascade (n = 0) ; sinon elle doit
  -- être équilibrée et comporter au moins deux lignes.
  if n > 0 and (d <> c or n < 2) then
    raise exception 'écriture % déséquilibrée (débit % ≠ crédit % ou < 2 lignes)', eid, d, c;
  end if;
  return null;
end;
$$ language plpgsql;

create constraint trigger ledger_line_balanced
  after insert or update or delete on ledger_line
  deferrable initially deferred
  for each row execute function check_entry_balanced();

-- Factures fournisseurs (charges externes) : document opérationnel, relié aux
-- écritures générées (facture au journal AC, règlement au journal BQ).
create table supplier_invoice (
  id                 uuid primary key default gen_random_uuid(),
  supplier_id        uuid not null references supplier(id),
  label              text not null,
  invoice_number     text not null default '',
  invoice_date       date not null,
  due_date           date,
  amount_cents       bigint not null check (amount_cents > 0),
  expense_account_id uuid not null references account(id),
  status             text not null default 'a_payer' check (status in ('a_payer','payee')),
  paid_date          date,
  payment_account_id uuid references account(id),
  entry_id           uuid references ledger_entry(id),
  payment_entry_id   uuid references ledger_entry(id),
  notes              text not null default '',
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index supplier_invoice_supplier_idx on supplier_invoice(supplier_id);
create index supplier_invoice_status_idx on supplier_invoice(status);

-- Plan de comptes : PCG français réduit, adapté location meublée (LMNP,
-- franchise TVA art. 293 B). Tous marqués is_system (protégés) ; la génération
-- automatique référence les codes marqués (*) ci-dessous.
insert into account (code, name, is_system) values
  ('108000', 'Compte de l''exploitant',                        true),
  ('164000', 'Emprunts auprès des établissements de crédit',   true),
  ('165000', 'Dépôts et cautionnements reçus',                 true),
  ('218000', 'Autres immobilisations corporelles (mobilier)',  true),
  ('281800', 'Amortissements des immobilisations corporelles', true),
  ('401000', 'Fournisseurs',                                   true),  -- (*)
  ('411000', 'Clients',                                        true),  -- (*)
  ('419000', 'Clients — avances et acomptes reçus',            true),
  ('445660', 'TVA déductible',                                 true),
  ('445710', 'TVA collectée',                                  true),
  ('447800', 'Taxe de séjour à reverser',                      true),  -- (*)
  ('467000', 'Autres comptes débiteurs ou créditeurs',         true),
  ('512100', 'Banque',                                         true),  -- (*)
  ('517000', 'Stripe (compte de paiement)',                    true),  -- (*)
  ('530000', 'Caisse',                                         true),
  ('606100', 'Eau, électricité, chauffage',                    true),
  ('606300', 'Petit équipement et fournitures',                true),
  ('606800', 'Autres achats (linge, consommables)',            true),
  ('614000', 'Charges de copropriété',                         true),
  ('615200', 'Entretien et réparations',                       true),
  ('616000', 'Assurances',                                     true),
  ('622600', 'Honoraires (comptable, juridique)',              true),
  ('623000', 'Publicité et annonces',                          true),
  ('626000', 'Frais postaux et télécommunications',            true),
  ('627000', 'Services bancaires (frais Stripe)',              true),
  ('635110', 'Cotisation foncière des entreprises (CFE)',      true),
  ('635120', 'Taxe foncière',                                  true),
  ('661100', 'Intérêts d''emprunt',                            true),
  ('681100', 'Dotations aux amortissements',                   true),
  ('706000', 'Locations meublées (hébergement)',               true),  -- (*)
  ('708300', 'Prestations annexes (ménage, linge, options)',   true),  -- (*)
  ('708800', 'Indemnités et dédommagements (cautions retenues)', true),-- (*)
  ('758000', 'Produits divers de gestion courante',            true),
  ('768000', 'Autres produits financiers',                     true);
