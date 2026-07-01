# Les Ménuires — Plateforme de gestion locative

Plateforme de réservation et de gestion pour une résidence de location saisonnière
(semaine stricte samedi → samedi). Front public de réservation (choix de semaine,
tarifs, prestations, signature, acompte/solde/caution) + back-office
(éditorial, disponibilités, prestations, réservations, compta légère).

## Architecture

Monorepo :

```
apps/web    → Next.js 16 (App Router) — front public SEO + back-office /admin + espace client /espace
apps/api    → Rust / Axum — API REST, paiements, webhooks, scheduler, e-mails
infra       → docker-compose (Postgres local + stack de production), Caddyfile
docs        → PLAN.md (schéma BDD + tickets)
```

| Brique | Choix |
|---|---|
| Front | Next.js 16, mode `standalone` (self-hosted) |
| Back | Rust / Axum + SQLx |
| Base de données | PostgreSQL 16 |
| UI back-office | shadcn/ui (Tailwind + Radix) |
| Paiement | Stripe (PaymentIntents), derrière l'abstraction `PaymentProvider` (fallback mock) |
| E-mail | Resend, derrière `Notifier` (no-op sans clé) |
| Reverse-proxy (prod) | Caddy (TLS automatique Let's Encrypt) |

Détails d'avancement et décisions : voir [`docs/PLAN.md`](docs/PLAN.md).

## Développement local

Prérequis : Docker, Rust (stable), Node 22.

```bash
# 1. Base de données (Postgres dédié, port hôte 5544)
docker compose -f infra/docker-compose.yml up -d

# 2. API Rust (migrations + seed jouées au démarrage)
cd apps/api
cp .env.example .env          # ajuster si besoin
cargo run                     # http://localhost:8080

# 3. Front Next.js
cd apps/web
cp .env.example .env.local
npm install
npm run dev                   # http://localhost:3000
```

- Front public : http://localhost:3000
- Réservation : http://localhost:3000/reserver
- Back-office : http://localhost:3000/admin (identifiants = `ADMIN_EMAIL` / `ADMIN_PASSWORD`)
- Espace client : http://localhost:3000/espace

Sans `STRIPE_SECRET_KEY`, les paiements tournent en **mock** (flux complet simulé).
Sans `RESEND_API_KEY`, les e-mails sont désactivés (log uniquement).

## Variables d'environnement

- `apps/api/.env.example` — configuration de l'API (DB, CORS, Stripe, Resend, admin, scheduler, `COOKIE_SECURE`).
- `apps/web/.env.example` — URL publique de l'API.
- `.env.example` (racine) — variables du `docker-compose.prod.yml`.

## Qualité / CI

```bash
# API
cd apps/api && cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test

# Web
cd apps/web && npm run typecheck && npm run build
```

La CI (`.github/workflows/ci.yml`) rejoue ces étapes sur chaque push/PR.

## Déploiement (self-hosted)

Voir le runbook détaillé : [`docs/DEPLOY.md`](docs/DEPLOY.md).

En bref, depuis un serveur avec Docker et le domaine pointé dessus :

```bash
cp .env.example .env          # renseigner DOMAIN, secrets Postgres/admin/Stripe/Resend
docker compose -f infra/docker-compose.prod.yml --env-file .env up -d --build
```

Caddy termine le TLS et route `/api/*` + `/media/*` vers l'API, le reste vers le front.
Front et API partagent la même origine (`https://$DOMAIN`) : cookies et CORS « just work ».
