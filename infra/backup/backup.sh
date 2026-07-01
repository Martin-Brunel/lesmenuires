#!/bin/sh
# =============================================================================
# Sauvegarde périodique : dump Postgres (format custom) + archive du volume media,
# avec rétention. Tourne en boucle dans un conteneur sidecar (voir compose prod).
# Restauration : voir docs/DEPLOY.md.
# =============================================================================
set -eu

: "${POSTGRES_USER:?POSTGRES_USER requis}"
: "${POSTGRES_DB:?POSTGRES_DB requis}"
: "${PGPASSWORD:?PGPASSWORD requis}"

DIR=/backups
HOST="${POSTGRES_HOST:-postgres}"
INTERVAL="${BACKUP_INTERVAL_SECS:-86400}"        # 24 h par défaut
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
mkdir -p "$DIR"

run_once() {
  TS=$(date +%Y%m%d-%H%M%S)
  echo "[backup] $TS — début"

  if pg_dump -h "$HOST" -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc \
        -f "$DIR/db-$TS.dump.part"; then
    mv "$DIR/db-$TS.dump.part" "$DIR/db-$TS.dump"   # publication atomique
    echo "[backup] base OK -> db-$TS.dump"
  else
    echo "[backup] ERREUR pg_dump" >&2
    rm -f "$DIR/db-$TS.dump.part"
  fi

  if [ -d /media ]; then
    if tar czf "$DIR/media-$TS.tar.gz.part" -C /media . 2>/dev/null; then
      mv "$DIR/media-$TS.tar.gz.part" "$DIR/media-$TS.tar.gz"
      echo "[backup] media OK -> media-$TS.tar.gz"
    else
      echo "[backup] ERREUR archive media" >&2
      rm -f "$DIR/media-$TS.tar.gz.part"
    fi
  fi

  # Rétention : supprime les sauvegardes plus vieilles que RETENTION_DAYS jours.
  find "$DIR" -maxdepth 1 -name 'db-*.dump' -mtime +"$RETENTION_DAYS" -delete 2>/dev/null || true
  find "$DIR" -maxdepth 1 -name 'media-*.tar.gz' -mtime +"$RETENTION_DAYS" -delete 2>/dev/null || true
  echo "[backup] terminé — prochaine dans ${INTERVAL}s"
}

# Une sauvegarde immédiate au démarrage, puis à intervalle régulier.
while true; do
  run_once || echo "[backup] cycle en échec (voir logs)" >&2
  sleep "$INTERVAL"
done
