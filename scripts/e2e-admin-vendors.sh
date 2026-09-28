#!/usr/bin/env bash
# E2E: admin vendor round-trip.
#
# Boots a seeded dev environment (if not already up), then runs the
# admin-vendor regression guard. Exits non-zero on any failure.
#
# Usage:
#   scripts/e2e-admin-vendors.sh
#
# Requires:
#   - docker compose with citymarket-db running
#   - migrations applied (scripts/migrate.ts)
#   - ADMIN_EMAIL + ADMIN_PASSWORD env vars (or a seeded admin user)
#   - BASE_URL (defaults to http://127.0.0.1:4041)
#
# The underlying script (scripts/e2e-admin-vendors.mjs) is the source
# of truth for the assertion list — this wrapper just sets the env
# flag and forwards exit status.

set -euo pipefail

export E2E_ADMIN_VENDORS=1
export BASE_URL="${BASE_URL:-http://127.0.0.1:4041}"

if [[ -z "${ADMIN_PASSWORD:-}" ]]; then
  echo "ADMIN_PASSWORD env var is required" >&2
  exit 2
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "docker not found in PATH" >&2
  exit 2
fi

# Ensure the dev server is reachable. Skip the wait if the user has
# already started one.
if ! curl -fsS --max-time 2 "$BASE_URL/api/health" >/dev/null 2>&1; then
  echo "Dev server at $BASE_URL not reachable — start it first (e.g. pnpm dev)" >&2
  exit 2
fi

exec node "$(dirname "$0")/e2e-admin-vendors.mjs"
