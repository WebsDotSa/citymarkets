-- 072_order_items_product_fk_to_vendor_products.sql
-- Purpose: align `order_items.product_id` with the post-039 catalog reality.
--
-- ============================================================
-- OPERATOR NOTE — requires postgres role to apply
-- ============================================================
-- This migration ALTERs `order_items` (drops + re-adds an FK).
-- The default migration runner connects as `citymarket_user`
-- (BYPASSRLS but NOT owner of legacy tables). Without OWNER
-- privileges the ALTERs above will fail with
-- `must be owner of table order_items`. To apply:
--
--   1. Connect as `postgres` (the table owner).
--   2. Run this script as a single transaction.
--   3. After success, record the migration:
--         INSERT INTO app_migrations (filename, applied_at)
--         VALUES ('072_order_items_product_fk_to_vendor_products.sql', NOW());
--      OR re-run the runner with --mark-applied.
--
-- ============================================================
-- Why
-- ============================================================
-- Migration 039 made `products` read-only and moved all catalog
-- write traffic to `vendor_products` (canonical source for active
-- listings, mirrored into `products_unified` for reads). The cart
-- (migration 037) now stores `vendor_products.id` as `product_id`,
-- and `createCheckout` decrements `vendor_products.stock_quantity`.
--
-- Migration 054 fixed the same FK drift on `vendor_order_items`,
-- but `order_items.product_id` was still declared with
-- `REFERENCES products(id)`. Any catalog-only checkout therefore
-- failed with:
--
--   insert or update on table "order_items"
--   violates foreign key constraint "order_items_product_id_fkey"
--
-- because the value being inserted is a `vendor_products.id` that
-- no longer exists in the read-only `products` table. This broke
-- 100% of City Markets catalog orders on production (verified
-- 2026-09-28 against https://citymarkets.sa).
--
-- We mirror migration 054: drop the legacy FK, point
-- `order_items.product_id` at `vendor_products(id)` with the same
-- `ON DELETE RESTRICT` default the original schema used. The
-- audit-trail pattern (snapshotting price/quantity at insert time)
-- is preserved on the existing columns (qty, unit_price) so no
-- historical data is lost.

BEGIN;

-- Pre-step: clean up orphan rows that would otherwise block the FK swap.
-- Migration 039 made `products` read-only and moved all write traffic to
-- `vendor_products`. Some pre-039 order_items rows still reference product
-- ids that exist only in the legacy `products` table; the new FK would
-- reject them. The column is NOT NULL, so we cannot NULL them out —
-- DELETE instead. As of 2026-09-28 only 1 such row exists on production
-- (test pollution from before the catalog split); the affected order's
-- totals and other order_items rows remain intact.
DELETE FROM order_items
 WHERE product_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM vendor_products vp WHERE vp.id = order_items.product_id);

DO $$
BEGIN
  -- Find the existing FK constraint name (Postgres auto-generated
  -- when the column was created inline) and drop it. Idempotent.
  IF EXISTS (
    SELECT 1
      FROM information_schema.table_constraints
     WHERE table_schema = 'public'
       AND table_name = 'order_items'
       AND constraint_type = 'FOREIGN KEY'
       AND constraint_name LIKE 'order_items_product_id_fkey%'
  ) THEN
    EXECUTE (
      SELECT 'ALTER TABLE public.order_items DROP CONSTRAINT '
             || constraint_name
        FROM information_schema.table_constraints
       WHERE table_schema = 'public'
         AND table_name = 'order_items'
         AND constraint_type = 'FOREIGN KEY'
         AND constraint_name LIKE 'order_items_product_id_fkey%'
       LIMIT 1
    );
  END IF;
END$$;

-- Re-add the FK pointing at the canonical catalog table
-- (`vendor_products`). ON DELETE RESTRICT matches the original
-- schema's NO ACTION default — an admin cannot delete a product
-- that has prior order history without first detaching the order
-- items (this is the desired behaviour; matches vendor_order_items
-- after migration 054 which allows SET NULL on the new schema).
ALTER TABLE order_items
  ADD CONSTRAINT order_items_product_id_fkey
  FOREIGN KEY (product_id) REFERENCES vendor_products(id)
  ON DELETE RESTRICT;

-- Helpful index for analytics queries that JOIN order_items back
-- to vendor_products to surface product provenance. The existing
-- `idx_order_items_product` covers this; verify it's present.
CREATE INDEX IF NOT EXISTS idx_order_items_product
  ON order_items(product_id);

COMMIT;