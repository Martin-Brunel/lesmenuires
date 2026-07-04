#!/bin/sh
set -eu

mkdir -p /app/media
chown -R appuser:appuser /app/media

exec runuser -u appuser -- "$@"
