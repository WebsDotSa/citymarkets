#!/usr/bin/env bash
# scripts/grant-products-write.sh — emergency rollback for Slice 4.
#
# Why:
#   Migration 039 revokes INSERT/UPDATE/DELETE/TRUNCATE on the legacy
#   `products` table from the app role (`citymarket_user`). After that,
#   any admin product write that still hits `products` instead of
#   `vendor_products` will fail with "permission denied for table
#   products". Most legacy writes already migrated (Slices 1-3), but
#   if a regression appears, this script re-grants the write privileges
#   to unblock production. Run it from a Postgres superuser role (NOT
#   the application role — the app cannot self-recover).
#
# Usage:
#   DATABASE_URL=postgres://postgres:...@host/db ./scripts/grant-products-write.sh
#
# After using this, fix the regression forward and re-apply migration
# 039 (which is idempotent — REVOKE statements re-run cleanly).

set -euo pipefail

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL env var is required (use a superuser connection, not the app role)."
  exit 1
fi

echo "Re-granting INSERT/UPDATE/DELETE/TRUNCATE on `products` to citymarket_user..."
psql "${DATABASE_URL}" -v ON_ERROR_STOP=1 <<'SQL'
GRANT INSERT, UPDATE, DELETE, TRUNCATE ON TABLE products TO citymarket_user;
SQL

echo "Done. Verify with:"
echo "  psql \"${DATABASE_URL}\" -c \"SELECT grantee, privilege_type FROM information_schema.role_table_grants WHERE table_name='products' AND grantee='citymarket_user';\""
