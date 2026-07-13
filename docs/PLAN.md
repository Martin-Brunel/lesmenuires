# Plan technique — Plateforme de gestion locative « Les Ménuires »

> Statut : **produit implémenté et en consolidation avant mise en production.**
> Dernière mise à jour : 2026-07-13

> Le schéma ci-dessous conserve les décisions historiques. L'implémentation
> actuelle regroupe l'API et les tâches planifiées dans `apps/api`, utilise une
> signature électronique interne avec preuve SHA-256/IP/navigateur, et maintient
> le client TypeScript à la main. Les liens publics de checkout sont protégés par
> des jetons de capacité 256 bits ; les campagnes exigent un opt-in horodaté et
> proposent un désabonnement en un clic ; les factures émises sont numérotées et
> figées sous forme de snapshots.

## 1. Décisions verrouillées

| Sujet | Choix retenu |
|---|---|
| Périmètre | Mono-lot aujourd'hui, **modèle « Propriété » générique** (multi-lots prêt, pas de multi-tenancy SaaS) |
| Front public | **Next.js** (App Router), SEO-first, rendu serveur self-hosted (mode standalone Node) |
| UI back-office | **shadcn/ui** (Radix + Tailwind) pour une interface admin propre et cohérente |
| Back | **Rust / Axum** (API REST) + worker async |
| Base de données | **PostgreSQL** + SQLx |
| Hébergement | **Self-hosted** dans l'infra du client (docker-compose, reverse-proxy Caddy/Nginx) |
| Paiement | **Stripe**, derrière une abstraction `PaymentProvider` (fallback PayPlug possible) |
| Signature | **DocuSeal** self-hosted (open-source, eIDAS simple) |
| Compta | Édition **factures + quittances** + suivi **dépenses** + exports CSV/PDF (pas de partie double) |
| Tarification | **Semaine stricte samedi → samedi**, tarif par semaine |
| Statut fiscal | **LMNP**, SIRET à obtenir (champ prévu, non bloquant) ; **franchise en base de TVA** (art. 293 B CGI) par défaut |
| Notifications | **Email** pour le MVP, derrière abstraction `Notifier` (SMS activable plus tard) |

## 2. Architecture & dépôt

Monorepo, déploiements séparés :

```
/apps/web      → Next.js (front public SEO + back-office admin)
/apps/api      → Rust / Axum (API REST + webhooks Stripe/DocuSeal)
/apps/worker   → Rust (jobs async : emails, relances, solde, caution)
/packages/api-client → client TS typé généré depuis l'OpenAPI
/infra         → docker-compose, migrations SQL, config reverse-proxy
/docs          → ce plan, schéma BDD, specs
```

Briques transverses :
- **utoipa** : OpenAPI généré depuis le code Rust → client TS auto-généré (zéro désync front/back).
- **Jobs async** : queue Postgres-backed (`apalis` ou pattern outbox) — pas de Redis au départ.
- **Email** : Resend ou Brevo (transactionnel), moteur de séquences construit en interne.
- **Auth** : front public en *guest checkout + magic link* ; back-office en sessions sécurisées.
- **Abstractions** : `PaymentProvider`, `SignatureProvider`, `Notifier`, `Mailer` → testables et remplaçables.

## 3. Schéma de base de données

### Exploitant & propriété
- **operator** — `legal_name, siret (nullable), address, vat_regime (def. franchise_base), iban, email, phone, logo_url`
- **property** — `slug, name, description (blocks), address, capacity, bedrooms, surface, registration_number (meublé tourisme), tourist_tax_config (jsonb), status (draft/published)`
- **property_media** — `property_id, url, alt, position, type`
- **property_amenity** — équipements (jsonb sur property ou table de jointure)

### Disponibilités & tarifs (semaines samedi→samedi)
- **availability_week** — `property_id, start_date (samedi, PK), end_date, price_cents, status (available/blocked/booked), notes`
  - Le back-office fixe prix + statut par semaine ; helper « saison » pour saisie en masse.

### Catalogue prestations
- **product** — `name, description, price_cents, vat_rate, unit (per_stay/per_person/per_week), type (cleaning/linen/…), active, position`

### Clients / CRM
- **customer** — `email, first_name, last_name, phone, address, locale, marketing_consent, consent_at, source, notes`

### Réservation (cœur)
- **booking** — `reference, property_id, customer_id, week_start_date, status (enum), adults, children, subtotal_cents, products_total_cents, tourist_tax_cents, total_cents, deposit_cents, balance_cents, caution_cents, expires_at (panier), contract_id, stripe_customer_id, stripe_payment_method_id, confirmed_at, cancelled_at, cancel_reason, notes, timestamps`
- **booking_line** — `booking_id, kind (accommodation/product/tourist_tax/discount), label, product_id?, quantity, unit_price_cents, vat_rate, total_cents`
- **booking_event** — historique state machine : `booking_id, from_status, to_status, event, payload (jsonb), actor, created_at`

### Paiements
- **payment** — `booking_id, type (deposit/balance/caution_auth/caution_capture/refund), provider, provider_intent_id, amount_cents, captured_amount_cents, status (pending/authorized/succeeded/captured/canceled/failed/refunded), raw (jsonb)`

### Contrat
- **contract** — `booking_id, provider (docuseal), submission_id, status (sent/opened/signed/declined), signed_pdf_url, sent_at, signed_at`

### Comptabilité
- **invoice** — `booking_id?, type (invoice/quittance/credit_note), number (séquentiel), issued_at, customer_snapshot (jsonb), total_cents, vat_cents, pdf_url, status`
- **expense** — `property_id, category, label, supplier, amount_cents, vat_cents, date, receipt_url, payment_method, notes`

### Prestataires
- **provider** — `name, type (cleaning/keys/maintenance), email, phone, active, notes`
- **task** — `booking_id, provider_id, type, scheduled_date, status (pending/notified/done), notified_at, completed_at, notes`

### CRM / automations
- **email_template** — `key, subject, body (handlebars/mjml), locale`
- **automation** — `name, trigger (booking_status_changed/cart_abandoned/before_checkin/after_checkout), offset, template_key, conditions (jsonb), active`
- **email_log** — `booking_id?, customer_id?, template_key, to, status, provider_msg_id, sent_at, opened_at`

### Système
- **scheduled_job** — `kind, run_at, payload (jsonb), status, attempts, locked_at` (si pas apalis)
- **admin_user** — `email, password_hash, role`
- **magic_link** — `customer_id, token, expires_at, used_at`

## 4. Machine à états de la réservation

```
PANIER → DEVIS → CONTRAT_ENVOYÉ → CONTRAT_SIGNÉ → ACOMPTE_PAYÉ
  → CONFIRMÉE → (J-30) SOLDE_PAYÉ → (J-5) CAUTION_AUTORISÉE
  → CHECK-IN (mail d'accueil) → CHECK-OUT
  → CAUTION_LIBÉRÉE / CAUTION_CAPTURÉE → CLÔTURÉE

Branches : PANIER —(timeout)→ ABANDONNÉ (relances) ;
           tout état —(annulation)→ ANNULÉE (remboursement éventuel)
```

Chaque transition est journalisée (`booking_event`) et peut déclencher un effet (email, job, notif prestataire). Implémentée comme state machine explicite et testée.

## 5. Flux Stripe (acompte / solde / caution)

- **Acompte** : `PaymentIntent` carte à la signature du contrat.
- **Solde** : prélèvement automatique à **J-30** (job), carte enregistrée.
- **Caution** (empreinte) — autorisation Stripe = 7 jours max, donc :
  1. À la réservation → `SetupIntent` enregistre la carte (consentement explicite).
  2. À **J-5** (job) → `PaymentIntent` `capture_method=manual` → empreinte réelle.
  3. Au départ → **capture** (partielle si dégâts) ou **annulation** (libération).
  - Fallback 3DS off-session : email « confirmez votre caution ».

## 6. Jobs planifiés (worker)

| Job | Déclenchement |
|---|---|
| Relance abandon panier | T+1h, T+24h après abandon |
| Prélèvement du solde | J-30 avant le samedi d'arrivée |
| Autorisation caution | J-5 |
| Email d'accueil | J-1 / jour du check-in |
| Notif ménage + remise clés | à la confirmation + rappel J-1 |
| Email post-séjour (avis) | J+1 après check-out |
| Rappel libération/capture caution | au check-out |

## 7. Spécificités légales FR à coder

- **Taxe de séjour** : calcul par nuit / par personne (config par propriété), ligne dédiée.
- **Contrat de location saisonnière** : mentions obligatoires, état des lieux.
- **Factures** : SIRET, mention « TVA non applicable, art. 293 B du CGI » (franchise), numérotation séquentielle.
- **RGPD** : consentement marketing explicite et horodaté pour le CRM.
- **Numéro d'enregistrement meublé de tourisme** affiché.

## 8. Découpage en tickets (par phase)

### Phase 0 — Socle
- T0.1 Monorepo + docker-compose (api, worker, web, postgres, dociseal)
  — ✅ **Postgres dédié** (`infra/docker-compose.yml`, port 5544, isolé de l'infra hôte)
- T0.2 Axum : squelette, config, healthcheck, migrations SQLx
  — ✅ **fait** : `apps/api` (Axum + SQLx, migrations + seed L'Adret, CORS), endpoints
    `health` / `booking-context/:slug` / `POST bookings` / `GET bookings/:ref`, pricing serveur.
    Build OK, endpoints testés (acompte/solde/caution + garde-fous 400/404).
- T0.3 OpenAPI (utoipa) + génération client TS — _à faire_
- T0.4 Next.js : squelette App Router + design tokens (en attente maquettes)
- T0.5 Back-office : setup **shadcn/ui** (Tailwind + Radix), thème, composants de base (table, form, dialog, toast)

### Phase 1 — Domaine & éditorial
- T1.1 Modèle Property + media + amenities (CRUD admin)
  — ✅ éditorial + **photos** (upload self-host disque `MEDIA_DIR`, servies sur `/media`,
    gérées dans l'admin : ajout, ré-ordre, alt, suppression). Galerie publique dynamique
    (photos uploadées, sinon fallback). Migration 0004.
- T1.2 Pages éditoriales Next SSG/ISR (SEO : metadata, sitemap, schema.org)
- T1.3 Calendrier availability_week + tarifs (back-office)
  — ✅ édition prix/statut + **génération de semaines** samedi→samedi (libellés/dates FR auto)
    + suppression (garde FK).

### Phase 2 — Funnel de réservation
- T2.1 State machine booking + booking_line + pricing (semaine + prestations + taxe séjour)
- T2.2 Front : sélection semaine + visualisation tarif + prestations + panier
  — ✅ **maquette implémentée** dans `apps/web` (tunnel desktop + mobile responsive, signature
    canvas, récap acompte/solde/caution). Données et paiement mockés, à brancher sur l'API.
- T2.3 Guest checkout (magic link) + customer
- T2.4 Abandon panier + relances (jobs)

### Phase 3 — Paiement
- T3.1 Abstraction PaymentProvider + impl Stripe + webhooks
- T3.2 Acompte + SetupIntent (enregistrement carte)
- T3.3 Solde J-30 (job) + caution J-5 (job) + capture/libération

### Phase 4 — Contrat & accueil
- T4.1 Abstraction SignatureProvider + impl DocuSeal + webhooks
- T4.2 Génération contrat (mentions obligatoires) + archivage PDF signé
- T4.3 Email d'accueil automatique

### Phase 5 — Back-office
- T5.1 Auth admin + dashboard résas
  — ✅ **fait** : comptes en base (argon2 + sessions cookie HttpOnly), guard /admin, dashboard.
- T5.2 Édition éditoriale, dispos, produits, tarifs
  — ✅ **fait** : `/admin` en shadcn/ui (Tailwind v4, isolé du front public) avec 4 zones —
    Dispos & tarifs (édition prix/statut), Contenu éditorial (form propriété), Prestations
    (CRUD), Réservations (liste). Écritures protégées par session ; modifications reflétées
    instantanément sur le front public.

### Phase 6 — Compta
- T6.1 Génération factures + quittances (PDF, numérotation, franchise TVA)
- T6.2 Suivi dépenses + catégories
- T6.3 Exports CSV/PDF pour comptable

### Phase 7 — CRM & prestataires
- T7.1 Moteur de séquences email + templates + email_log
- T7.2 Automations (avant/après séjour, avis)
- T7.3 Prestataires + tasks + notifications auto

## 9. Questions ouvertes / à préparer côté client

- Obtenir le **SIRET** (guichet unique, gratuit) pour factures conformes + Stripe fluide.
- Fournir les **maquettes** (front public + back-office).
- Créer les comptes : **Stripe**, domaine email (SPF/DKIM), serveur pour self-hosting.
