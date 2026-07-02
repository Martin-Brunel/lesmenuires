# Runbook de déploiement — self-hosted

Déploiement de la plateforme sur un serveur du client, via Docker Compose +
Caddy (TLS automatique). Un seul domaine sert le front, l'API et les médias.

## 1. Prérequis serveur

- Docker + Docker Compose v2.
- Un domaine (ex. `reservation.exemple.fr`) dont l'enregistrement DNS **A/AAAA
  pointe vers l'IP du serveur** (nécessaire pour l'émission du certificat).
- Ports **80** et **443** ouverts (Let's Encrypt + trafic public).

## 2. Récupérer le code et configurer

```bash
git clone <repo> lesmenuires && cd lesmenuires
cp .env.example .env
```

Renseigner `.env` (racine) :

| Variable | Rôle |
|---|---|
| `DOMAIN` | domaine public (ex. `reservation.exemple.fr`) |
| `ACME_EMAIL` | e-mail Let's Encrypt |
| `POSTGRES_PASSWORD` | mot de passe Postgres (fort) |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | compte admin seedé au 1er démarrage |
| `STRIPE_SECRET_KEY` / `STRIPE_PUBLISHABLE_KEY` | clés **live** en production |
| `STRIPE_WEBHOOK_SECRET` | secret du endpoint webhook (étape 5) |
| `RESEND_API_KEY` / `MAIL_FROM` | envoi d'e-mails (domaine vérifié) |

> `COOKIE_SECURE=true`, `FRONT_ORIGIN`/`API_BASE_URL=https://$DOMAIN` et
> `DATABASE_URL` sont déjà câblés dans `infra/docker-compose.prod.yml`.

## 3. Lancer la stack

```bash
docker compose -f infra/docker-compose.prod.yml --env-file .env up -d --build
```

Au démarrage : Postgres monte, l'API joue les **migrations** puis **seed** l'admin,
le worker de fond (solde/caution/relances) démarre, Caddy obtient le certificat TLS.

Vérifier :

```bash
docker compose -f infra/docker-compose.prod.yml ps
curl -s https://$DOMAIN/api/health          # {"status":"ok"}
```

- Front : `https://$DOMAIN`
- Back-office : `https://$DOMAIN/admin`

## 4. Données initiales

Le seed crée la propriété de démonstration et l'admin. Depuis le back-office :
1. Éditorial : contenu, photos, consignes d'arrivée.
2. Saisons : créer la saison active + paliers de prix.
3. Disponibilités : générer les semaines samedi→samedi.
4. Prestations : ménage, linge, etc.

## 5. Webhook Stripe

Dans le dashboard Stripe → Developers → Webhooks, ajouter un endpoint :

```
https://$DOMAIN/api/payments/webhook
```

Événement minimal : `payment_intent.succeeded`. Copier le **signing secret**
(`whsec_…`) dans `STRIPE_WEBHOOK_SECRET` (.env), puis relancer l'API :

```bash
docker compose -f infra/docker-compose.prod.yml --env-file .env up -d api
```

## 6. E-mail (Resend)

En production, vérifier le domaine sur resend.com/domains (SPF/DKIM) et régler
`MAIL_FROM` sur une adresse de ce domaine. En mode test, Resend ne délivre qu'à
l'adresse du compte.

## 7. Exploitation

```bash
# Logs
docker compose -f infra/docker-compose.prod.yml logs -f api
docker compose -f infra/docker-compose.prod.yml logs -f caddy

# Mise à jour (après git pull)
docker compose -f infra/docker-compose.prod.yml --env-file .env up -d --build

# Sauvegarde manuelle ponctuelle (en plus des sauvegardes automatiques)
docker compose -f infra/docker-compose.prod.yml exec -T postgres \
  pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" > backup-$(date +%F).sql
```

### Sauvegardes automatiques

Le service **`backup`** (compose prod) réalise automatiquement, dès le démarrage
puis toutes les `BACKUP_INTERVAL_SECS` (défaut 24 h) :
- un dump Postgres au **format custom** (`db-<horodatage>.dump`),
- une archive du volume media (`media-<horodatage>.tar.gz`),

dans le volume `backups`, avec rétention `BACKUP_RETENTION_DAYS` (défaut 14 j).
Les fichiers sont publiés atomiquement (`.part` → renommage) pour ne jamais
exposer une sauvegarde tronquée.

```bash
# Lister les sauvegardes disponibles
docker compose -f infra/docker-compose.prod.yml exec backup ls -lh /backups

# Copier les sauvegardes hors du serveur (À FAIRE régulièrement — off-site)
docker compose -f infra/docker-compose.prod.yml cp backup:/backups ./backups-$(date +%F)
```

**Restauration de la base** (format custom → `pg_restore`). Le dump vit dans le
volume `backups` ; on lance un conteneur éphémère qui monte ce volume et joint le
réseau du compose (`⚠ --clean --if-exists` écrase les données existantes) :

```bash
# 1) Repérer le dump voulu
docker compose -f infra/docker-compose.prod.yml exec backup ls /backups
# 2) Restaurer
docker run --rm --network lesmenuires-prod_default \
  -e PGPASSWORD="$POSTGRES_PASSWORD" \
  -v lesmenuires-prod_backups:/backups \
  postgres:16-alpine \
  pg_restore -h postgres -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
    --clean --if-exists /backups/db-<horodatage>.dump
```

**Restauration du media** (depuis l'archive dans le volume `backups`) :

```bash
docker run --rm \
  -v lesmenuires-prod_backups:/backups \
  -v lesmenuires-prod_media:/media \
  alpine sh -c "cd /media && tar xzf /backups/media-<horodatage>.tar.gz"
```

> Le round-trip dump → `pg_restore` a été validé (compte de lignes identique).
> Pensez à **externaliser** régulièrement le volume `backups` (le service protège
> d'une corruption logique, pas d'une perte du serveur entier).

Volumes persistants : `pgdata` (base), `media` (photos), `backups` (sauvegardes),
`caddy_data` (certificats).

## 8. Checklist avant ouverture au public

À faire une fois, dans l'ordre, avant de recevoir de vrais clients.

### Secrets & environnement
- [ ] `POSTGRES_PASSWORD` et `ADMIN_PASSWORD` : secrets forts (pas les valeurs d'exemple).
- [ ] `APP_ENV=production` (posé par le compose prod) — l'API refuse alors de
      démarrer avec le provider de paiement `mock` (garde fail-closed).
- [ ] `COOKIE_SECURE=true` (posé par le compose) — cookies en `Secure` derrière TLS.

### Paiement (Stripe)
- [ ] Renseigner les clés **live** : `STRIPE_SECRET_KEY` (`sk_live_…`) et
      `STRIPE_PUBLISHABLE_KEY` (`pk_live_…`).
- [ ] Créer le webhook Stripe vers `https://$DOMAIN/api/payments/webhook` et
      copier le secret dans `STRIPE_WEBHOOK_SECRET` (`whsec_…`). **Obligatoire** :
      sans lui, l'API rejette les webhooks (fail-closed) → les confirmations
      asynchrones ne passeraient pas. Events utiles : `payment_intent.succeeded`,
      `payment_intent.payment_failed`, `charge.refunded`, `charge.dispute.created`.
- [ ] Tester un vrai paiement d'acompte de bout en bout, puis vérifier qu'un
      remboursement fait depuis le dashboard Stripe remonte bien (badge admin).

### E-mails (Resend)
- [ ] Vérifier un domaine sur resend.com et pointer `MAIL_FROM` dessus (sinon
      Resend en mode test ne délivre qu'à l'adresse du compte).
- [ ] `API_BASE_URL` / `FRONT_ORIGIN` = `https://$DOMAIN` (liens des e-mails).

### Identité légale & contenu (inlinés au build du front → reconstruire `web`)
- [ ] Renseigner `NEXT_PUBLIC_EDITOR_*` et `NEXT_PUBLIC_HOST_*` (mentions légales)
      et `NEXT_PUBLIC_CONTACT_EMAIL` — sinon les pages affichent « à compléter ».
- [ ] Vérifier la **station** : le seed initial et d'anciens textes mentionnaient
      « Grand-Bornand » alors que le bien est aux **Ménuires** → contrôler
      `property.location_label` en base et corriger si besoin (admin Éditorial).
- [ ] Renseigner le **montant de la taxe de séjour** (admin Éditorial) si applicable.

### Exploitation
- [ ] `NEXT_PUBLIC_API_URL` est inliné au build (build-arg = `https://$DOMAIN`) :
      un changement de domaine impose de reconstruire l'image `web`.
- [ ] **Externaliser** le volume `backups` hors du serveur (cron `docker cp` +
      copie off-site) et tester une restauration réelle au moins une fois.
- [ ] Surveiller `/api/health` (sonde externe) et le panneau « Actions requises »
      du tableau de bord (soldes en retard, litiges, échecs de prélèvement).
- [ ] Ne pas scaler l'API à plusieurs replicas : le scheduler tourne in-process
      sans verrou distribué (mono-instance assumé pour ce déploiement).
