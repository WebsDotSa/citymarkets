-- Migration: Make the legacy `products` table read-only for the app role (Slice 4)
-- Date: 2026-08-01
--
-- Why:
--   Slices 1-3 of the multi-vendor migration switched the public-facing reads
--   to the `products_unified` view (migration 036) and the checkout writes
--   (parent + children) to the new `orders` / `vendor_orders` tables
--   (migration 038). The legacy `products` table is now only kept for the
--   `category_id` count aggregates + a few legacy view dependencies.
--
--   To prevent the app from accidentally inserting/editing/duplicating a row
--   straight into `products` again (which would silently disagree with the
--   `vendor_products` source of truth), we strip the app role's write
--   privileges. The app role `citymarket_user` already has SELECT via the
--   blanket `GRANT ALL ON ALL TABLES IN SCHEMA public TO citymarket_user`
--   in migration 001.
--
--   Emergency rollback: re-grant via `scripts/grant-products-write.sh`
--   (psql EXECUTE wrapper). Use only to recover from a Slice 4 regression
--   and then fix forward.
--
-- All changes are idempotent and safe to re-run.

BEGIN;

-- 1. Revoke write privileges on the legacy `products` table. `SELECT`
-- survives the blanket grant from migration 001.
REVOKE INSERT, UPDATE, DELETE ON TABLE products FROM citymarket_user;

-- 2. Defense in depth — also revoke TRUNCATE (rare, but a TRUNCATE in
-- production would be a worst-case data-loss bug).
REVOKE TRUNCATE ON TABLE products FROM citymarket_user;

COMMIT;
