#!/bin/sh
set -e
DB_PATH="${HMR_DB_PATH:-/data/hmr.db}"
SEED_PATH="${HMR_DB_SEED_PATH:-/app/seed/hmr.db}"

if [ ! -f "$DB_PATH" ] && [ -f "$SEED_PATH" ]; then
  echo "docker-entrypoint: seeding $DB_PATH from $SEED_PATH"
  mkdir -p "$(dirname "$DB_PATH")"
  cp "$SEED_PATH" "$DB_PATH"
fi

if [ ! -f "$DB_PATH" ]; then
  echo "docker-entrypoint: warning: no database at $DB_PATH (empty app until you add hmr.db or mount /data)"
  mkdir -p "$(dirname "$DB_PATH")" || true
fi

exec node server.js
