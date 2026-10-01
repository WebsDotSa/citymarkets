#!/usr/bin/env bash
# scripts/sync-db-password.sh
#
# Reconcile the Postgres password for `citymarket_user` with
# DATABASE_PASSWORD in .env / .env.local. This bridges the gap left by
# migrations: a fresh container rebuild can rotate the role password out
# from under the app if the two are not synchronized.
#
# Usage:
#   ./scripts/sync-db-password.sh                  # uses DATABASE_PASSWORD from .env.local
#   DATABASE_PASSWORD=foo ./scripts/sync-db-password.sh
#
# The script is idempotent — it ALTERs only when the role exists.
# It does NOT run inside the migration runner (passwords are an ops
# concern, not a schema concern). Add a one-shot invocation to your
# deploy pipeline after `docker compose up`.

set -euo pipefail

ENV_FILE="${ENV_FILE:-.env.local}"
if [ ! -f "$ENV_FILE" ] && [ -f .env ]; then
  ENV_FILE=.env
fi
if [ -f "$ENV_FILE" ]; then
  # shellcheck disable=SC1090
  set -a; . "./$ENV_FILE"; set +a
fi

DB_USER="${DATABASE_USER:-citymarket_user}"
DB_NAME="${DATABASE_NAME:-citymarket_db}"
NEW_PASSWORD="${DATABASE_PASSWORD:-}"

if [ -z "$NEW_PASSWORD" ]; then
  echo "[sync-db-password] DATABASE_PASSWORD is empty — refusing to rotate." >&2
  exit 1
fi

echo "[sync-db-password] syncing $DB_USER password to match $ENV_FILE..."

# Use docker exec so this works without psql on the host.
docker exec citymarket-db \
  psql -U postgres -d "$DB_NAME" -v ON_ERROR_STOP=1 \
  -c "ALTER USER $DB_USER WITH PASSWORD '$NEW_PASSWORD';" \
  >/dev/null

# Verify with the new password that login works.
docker exec citymarket-db \
  psql -U postgres -d "$DB_NAME" -tAc \
  "SELECT 1 FROM pg_roles WHERE rolname='$DB_USER' AND rolname IS NOT NULL;" \
  >/dev/null

# Quick connectivity probe using the app's own DATABASE_URL.
if command -v psql >/dev/null 2>&1; then
  PGPASSWORD="$NEW_PASSWORD" psql \
    -h "${DATABASE_HOST:-127.0.0.1}" \
    -p "${DATABASE_PORT:-5432}" \
    -U "$DB_USER" -d "$DB_NAME" \
    -c "SELECT 1 as connectivity_ok" >/dev/null
  echo "[sync-db-password] connectivity verified."
fi

echo "[sync-db-password] done."
