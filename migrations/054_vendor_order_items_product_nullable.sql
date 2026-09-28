-- 054_vendor_order_items_product_nullable.sql
-- Purpose: allow admin to delete a vendor_products row even when it is
-- referenced by past vendor_order_items.
--
-- ============================================================
-- OPERATOR NOTE — requires postgres role to apply
-- ============================================================
-- This migration ALTERs `vendor_order_items` (drops + re-adds an FK,
-- drops NOT NULL). The default migration runner connects as
-- `citymarket_user` (BYPASSRLS but NOT owner of legacy tables).
-- Without OWNER privileges the ALTERs above will fail with
-- `must be owner of table vendor_order_items`.
--
-- To apply:
--   1. Connect as `postgres` (the table owner).
--   2. Run this script as a single transaction.
--   3. After success, insert a tracking row manually so the
--      runner doesn't try to re-apply:
--         INSERT INTO app_migrations (filename, applied_at)
--         VALUES ('054_vendor_order_items_product_nullable.sql', NOW());
--      OR re-run the runner with --mark-applied once the DB is in the
--      post-migration state.
-- ============================================================
--
-- Before this migration, vendor_order_items.product_id was declared with
-- `REFERENCES vendor_products(id)` and the default ON DELETE behaviour
-- (NO ACTION). That made the DELETE endpoint in /api/admin/products fail
-- with a foreign-key violation for any product with prior order history,
-- even though the admin never operates on customer order history — the
-- audit trail (`product_name_snapshot`, `unit_price`) is preserved on the
-- order item line itself, so dropping the FK to the live product row is
-- safe and matches the existing pattern used by direct_orders / analytics
-- (migrations 053 / 041 — both use `ON DELETE SET NULL`).
--
-- We make product_id nullable and switch to ON DELETE SET NULL so an
-- admin can delete a product without orphaning or deleting past orders.
-- The product_name_snapshot already captures the human-readable identity
-- at order time, so historical reports stay consistent.

BEGIN;

DO $$
BEGIN
  -- Find the existing FK constraint name (Postgres auto-generated when the
  -- column was created inline) and drop it. Wrap in a guard so the
  -- migration is idempotent on databases where this has already been
  -- applied.
  IF EXISTS (
    SELECT 1
      FROM information_schema.table_constraints
     WHERE table_schema = 'public'
       AND table_name = 'vendor_order_items'
       AND constraint_type = 'FOREIGN KEY'
       AND constraint_name LIKE 'vendor_order_items_product_id_fkey%'
  ) THEN
    EXECUTE (
      SELECT 'ALTER TABLE public.vendor_order_items DROP CONSTRAINT '
             || constraint_name
        FROM information_schema.table_constraints
       WHERE table_schema = 'public'
         AND table_name = 'vendor_order_items'
         AND constraint_type = 'FOREIGN KEY'
         AND constraint_name LIKE 'vendor_order_items_product_id_fkey%'
       LIMIT 1
    );
  END IF;
END$$;

-- Make the column nullable so it can hold NULL after a product deletion.
-- product_name_snapshot on the same row holds the historical product name,
-- so a NULL product_id does not lose any business information.
ALTER TABLE vendor_order_items
  ALTER COLUMN product_id DROP NOT NULL;

-- Re-add the FK with ON DELETE SET NULL so the DB does the right thing
-- automatically and admin DELETE never hits a 500 from this constraint.
ALTER TABLE vendor_order_items
  ADD CONSTRAINT vendor_order_items_product_id_fkey
  FOREIGN KEY (product_id) REFERENCES vendor_products(id)
  ON DELETE SET NULL;

-- Helpful for analytics queries that filter "items with a current
-- product reference vs. detached historical rows".
CREATE INDEX IF NOT EXISTS idx_vendor_order_items_product
  ON vendor_order_items(product_id)
  WHERE product_id IS NOT NULL;

COMMIT;
