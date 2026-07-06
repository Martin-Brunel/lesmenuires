---
name: verify
description: Vérifier un changement en conditions réelles (API Rust + front Next) — lancer les serveurs dev, piloter l'API en curl et l'admin en Chrome headless CDP.
---

# Vérification runtime — Les Ménuires

## Lancer l'environnement dev

Postgres dev tourne en Docker (`lesmenuires-postgres`, port hôte 5544). S'il est arrêté : `docker start lesmenuires-postgres`.

```bash
# API (applique les migrations SQLx au démarrage) — env dans apps/api/.env
cd apps/api && cargo run          # en tâche de fond ; écoute sur :8080

# Front Next (Turbopack) — JAMAIS piper dans `head` (bloque le serveur quand head sort)
cd apps/web && npm run dev        # en tâche de fond ; écoute sur :3000
```

`GET /` du front répond **307** (redirection locale), pas 200 — attendre `curl -s -o /dev/null -w '%{http_code}' localhost:3000/admin` = 200.

## Surfaces

- **API publique** : `curl http://localhost:8080/api/booking-context/ladret` (slug propriété dev = `ladret`).
- **API admin** : login puis cookie jar :
  ```bash
  curl -c cookies.txt -X POST localhost:8080/api/admin/login \
    -H 'content-type: application/json' \
    -d '{"email":"martin@spottt.fr","password":"changeme-dev"}'
  curl -b cookies.txt localhost:8080/api/admin/settings
  ```
- **Admin UI** : Chrome headless + CDP (WebSocket natif Node ≥ 22), cookie `session` du jar. Lancer Chrome séparément puis se connecter :
  ```bash
  google-chrome --headless=new --remote-debugging-port=9399 --no-first-run \
    --user-data-dir=/tmp/chrome-prof --window-size=1280,2000 about:blank &
  ```
  Puis script Node : `fetch /json/list` → WebSocket sur la page → `Network.setCookie` (domain `localhost`, httpOnly) → `Page.navigate` → `Page.captureScreenshot`. Pour piloter un input React contrôlé : setter natif `HTMLInputElement.prototype.value` + `dispatchEvent(new Event('input',{bubbles:true}))`, puis `.click()` sur le bouton.

## Pièges

- `pkill -f`/`pgrep -af` avec un motif présent dans la ligne de commande du shell courant **tue la session bash elle-même** (exit 144). Utiliser `fuser -k 3000/tcp`, ou `pgrep -a chrome | awk '{print $1}' | xargs kill`.
- `npm run dev | head -N` : quand `head` sort, Next bloque sur stdout cassé — le serveur pend silencieusement (requêtes sans réponse, aucun log). Rediriger vers un fichier.
- Mutations de test en base dev : noter/sauver l'état d'origine avant, et nettoyer après (dossiers `cart` créés → `delete from booking_line/booking_event/booking where reference=...`).
