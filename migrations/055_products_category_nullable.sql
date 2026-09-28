-- 055_products_category_nullable.sql
-- Purpose: allow admin to delete a category that still references legacy
-- `products` rows without breaking the FK constraint (RESTRICT) or
-- deleting the products themselves.
--
-- ============================================================
-- OPERATOR NOTE — requires postgres role to apply
-- ============================================================
-- Migration 039 explicitly REVOKED grants on the legacy `products`
-- table from `citymarket_user`. As a result the default migration
-- runner cannot ALTER this table. To apply:
--   1. Connect as `postgres` (the table owner).
--   2. Run this script as a single transaction.
--   3. Insert a tracking row into `app_migrations` afterwards
--      (or use --mark-applied) so the runner doesn't re-apply.
-- ============================================================
--
-- Before this migration, `products.category_id` was declared
--   `UUID NOT NULL REFERENCES categories(id) ON DELETE RESTRICT`
-- so any row referencing a category would block admin DELETE on the
-- category. Combined with the fact that citymarket_user does not own
-- the legacy `products` table (grants revoked in migration 039), admin
-- could not unblock the deletion by editing the legacy rows either.
--
-- We follow the same pattern as migration 054: make the column
-- nullable, switch the FK to ON DELETE SET NULL, and add a partial
-- index for analytics queries that filter "categories that still have
-- a live product reference". The product row is preserved (with its
-- name / image / barcode / price) — only the breadcrumb path is lost.

BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM information_schema.table_constraints
     WHERE table_schema = 'public'
       AND table_name = 'products'
       AND constraint_type = 'FOREIGN KEY'
       AND constraint_name LIKE 'products_category_id_fkey%'
  ) THEN
    EXECUTE (
      SELECT 'ALTER TABLE public.products DROP CONSTRAINT '
             || constraint_name
        FROM information_schema.table_constraints
       WHERE table_schema = 'public'
         AND table_name = 'products'
         AND constraint_type = 'FOREIGN KEY'
         AND constraint_name LIKE 'products_category_id_fkey%'
       LIMIT 1
    );
  END IF;
END$$;

ALTER TABLE products
  ALTER COLUMN category_id DROP NOT NULL;

ALTER TABLE products
  ADD CONSTRAINT products_category_id_fkey
  FOREIGN KEY (category_id) REFERENCES categories(id)
  ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_products_category
  ON products(category_id)
  WHERE category_id IS NOT NULL;

COMMIT;
