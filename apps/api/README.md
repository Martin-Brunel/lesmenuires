# lesmenuires-api

API Rust / Axum + PostgreSQL (SQLx) — socle du tunnel de réservation **L'Adret**.

## Lancer

```bash
# 1. Base de données dédiée (depuis la racine du repo)
docker compose -f infra/docker-compose.yml up -d        # Postgres sur localhost:5544

# 2. API (migrations + seed appliqués au démarrage)
cd apps/api
cargo run                                               # http://localhost:8080
```

Config via `apps/api/.env` (voir `.env.example`) : `DATABASE_URL`, `BIND_ADDR`, `RUST_LOG`.

## Endpoints

| Méthode | Route | Rôle |
|---|---|---|
| GET  | `/api/health` | Liveness |
| GET  | `/api/booking-context/:slug` | Propriété + semaines dispo + prestations (1 appel pour le funnel) |
| POST | `/api/bookings` | Crée une réservation (panier), **montants calculés serveur** |
| GET  | `/api/bookings/:reference` | Lit une réservation |

### POST /api/bookings — corps

```json
{
  "propertySlug": "ladret",
  "weekId": "<uuid de la semaine>",
  "extras": ["draps", "menage"],
  "adults": 4,
  "customer": { "email": "...", "firstName": "...", "lastName": "...", "phone": "..." }
}
```

Renvoie `reference`, `status`, et les montants en centimes (`totalCents`, `depositCents`,
`balanceCents`, `cautionCents`). Garde-fous : semaine `booked` → 400, prestation inconnue → 400.

## Modèle (migrations `migrations/`)

`property`, `availability_week` (semaines samedi→samedi), `product`, `customer`,
`booking` + `booking_line`. Argent en **centimes** (`bigint`). Pricing dans `src/pricing.rs`
(jamais de montant accepté du client).

## À suivre (non encore fait)

- Brancher le front (`apps/web`) sur `/api/booking-context/:slug` (remplacer `data.ts`).
- OpenAPI (utoipa) → client TS typé.
- State machine de réservation, paiement Stripe, signature DocuSeal (cf. `docs/PLAN.md`).
