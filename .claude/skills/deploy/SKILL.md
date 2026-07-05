---
name: deploy
description: Déployer Les Ménuires en production (commit/push si besoin, puis rebuild Docker sur le VPS et vérifications post-déploiement). À utiliser quand l'utilisateur demande de déployer, mettre en prod, ou pousser une version sur le serveur.
---

# Déploiement production — Les Ménuires

Prod : `https://location-t2-lesmenuires.fr` (⚠ avec un « s » à Ménuires), VPS Hostinger
`root@187.55.225.249`, repo cloné dans `/root/lesmenuires`, stack Docker Compose + Caddy.
Runbook détaillé : `docs/DEPLOY.md`.

## 1. Préparer le code

1. Vérifier que ça compile : `cargo check` dans `apps/api`, `npx tsc --noEmit` dans `apps/web`.
2. Committer les changements voulus (messages style repo, ex. `feat(admin): …`) et pousser :
   `git push origin main`. Le serveur déploie depuis GitHub — rien ne part sans push.

## 2. Déployer sur le serveur

SSH direct depuis la machine dev (clé en agent). `-A` (agent forwarding) est requis pour
le `git pull` GitHub côté serveur.

```bash
ssh -A -o BatchMode=yes root@187.55.225.249 \
  "cd /root/lesmenuires && git pull && git log --oneline -1"

ssh -A -o BatchMode=yes root@187.55.225.249 \
  "cd /root/lesmenuires && docker compose -f infra/docker-compose.prod.yml --env-file .env \
     up -d --build > /root/deploy-\$(date +%F-%H%M).log 2>&1; echo EXIT=\$?"
```

- ⚠ Lancer le build en tâche de fond côté Claude (plusieurs minutes) et **rediriger le log
  buildkit vers le disque du serveur** (jamais capturé en local : il sature le tmpfs).
- ⚠ `docker compose ps/logs/exec` sur le serveur exigent aussi `--env-file .env`
  (interpolation de POSTGRES_PASSWORD), sinon erreur.
- Les migrations SQLx sont embarquées dans le binaire et s'appliquent au démarrage de l'API.
- ⚠ Toute variable `NEXT_PUBLIC_*` est inlinée au **build** du web : nouvelle variable →
  la référencer littéralement dans le code (`process.env.NEXT_PUBLIC_X`, jamais par clé
  dynamique) et rebuild de l'image web obligatoire.

## 3. Vérifier

```bash
ssh root@187.55.225.249 "cd /root/lesmenuires && \
  docker compose -f infra/docker-compose.prod.yml --env-file .env ps"
curl -s https://location-t2-lesmenuires.fr/api/health        # {"status":"ok"}
curl -s -o /dev/null -w '%{http_code}' https://location-t2-lesmenuires.fr/          # 307 → /reserver
curl -s -o /dev/null -w '%{http_code}' https://location-t2-lesmenuires.fr/admin/login  # 200
```

Tous les services doivent être `Up` (api/web `healthy`). En cas de souci :
`docker compose -f infra/docker-compose.prod.yml --env-file .env logs -f api` (ou `web`, `caddy`).

## 4. Annoncer

Résumer à l'utilisateur : commit(s) déployé(s), résultat des vérifications, et tout écart
(service unhealthy, log d'erreur, migration appliquée).
