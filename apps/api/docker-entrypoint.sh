#!/bin/sh
set -eu

mkdir -p /app/media
chown -R appuser:appuser /app/media

exec setpriv --reuid=10001 --regid=999 --clear-groups "$@"
