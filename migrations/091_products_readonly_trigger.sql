-- 091_products_readonly_trigger.sql
--
-- AUDIT 2026-09-30 / task 6.3.1: protect the legacy `products` table from
-- writes via a trigger. All catalog writes must go through `vendor_products`
-- (the modern, vendor-aware table). The legacy table is kept read-only so
-- storefront code that still reads `products` (e.g. `view_products_unified`,
-- some admin views) keeps working without risk of silent drift.
--
-- Why this matters:
--   - Migration 039 + 039b + 039c are the official "products is read-only"
--     milestones, but they relied on application discipline. A single
--     missed INSERT/UPDATE/DELETE in any new code path could re-introduce
--     drift (e.g. an admin route bypassing the vendor-aware path).
--   - A trigger enforces the rule at the database boundary: a writer
--     attempting to touch `products` will get an explicit error with
--     the migration number, so the offending code is easy to find.
--
-- Behaviour:
--   - INSERT / UPDATE / DELETE on the `products` table raises a clear
--     exception pointing the operator at this migration.
--   - TRUNCATE is NOT blocked because the DBA may still need it in
--     extreme recovery scenarios (re-import from a backup snapshot).
--     Audit logging around TRUNCATE is the DBA's responsibility.
--   - The trigger is created with `OR REPLACE` semantics so the
--     migration is idempotent.
--
-- Rollback:
--   DROP TRIGGER IF EXISTS products_readonly_guard ON products;

BEGIN;

CREATE OR REPLACE FUNCTION guard_products_readonly() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION
    'products is read-only since migration 091 (2026-09-30). '
    'All catalog writes must target vendor_products. '
    'If you reached this from a migration, use vendor_products instead. '
    'If you reached this from application code, that code path is a regression — '
    'open a ticket against src/lib/catalog/ before retrying.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS products_readonly_guard ON products;

CREATE TRIGGER products_readonly_guard
  BEFORE INSERT OR UPDATE OR DELETE ON products
  FOR EACH ROW EXECUTE FUNCTION guard_products_readonly();

COMMIT;