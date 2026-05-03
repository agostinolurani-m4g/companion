#!/bin/sh
set -e
DB_PATH="${HMR_DB_PATH:-/data/hmr.db}"
SEED_PATH="${HMR_DB_SEED_PATH:-/app/seed/hmr.db}"
DATA_DIR="$(dirname "$DB_PATH")"

run_as_nextjs() {
  exec runuser -u nextjs -g nodejs -- sh -c 'cd /app && exec node server.js'
}

# Avvio come root (default immagine): il volume Docker montato su /data è spesso root:root.
# SQLite in WAL deve poter scrivere DB + -wal/-shm → chown a nextjs prima di avviare Node.
if [ "$(id -u)" = "0" ]; then
  if [ ! -f "$DB_PATH" ] && [ -f "$SEED_PATH" ]; then
    echo "docker-entrypoint: seeding $DB_PATH from $SEED_PATH"
    mkdir -p "$DATA_DIR"
    cp "$SEED_PATH" "$DB_PATH"
  fi
  if [ ! -f "$DB_PATH" ]; then
    echo "docker-entrypoint: warning: no database at $DB_PATH (empty app until you add hmr.db)"
  fi
  mkdir -p "$DATA_DIR" || true
  chown -R nextjs:nodejs "$DATA_DIR"
  run_as_nextjs
fi

# Fallback: già utente nextjs
if [ ! -f "$DB_PATH" ] && [ -f "$SEED_PATH" ]; then
  echo "docker-entrypoint: seeding $DB_PATH from $SEED_PATH"
  mkdir -p "$DATA_DIR" || true
  cp "$SEED_PATH" "$DB_PATH" || true
fi
if [ ! -f "$DB_PATH" ]; then
  echo "docker-entrypoint: warning: no database at $DB_PATH"
  mkdir -p "$DATA_DIR" || true
fi

exec node server.js
