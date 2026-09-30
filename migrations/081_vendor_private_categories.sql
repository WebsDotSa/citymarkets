-- 080 — Per-vendor private categories.
--
-- Background: until now every category was global — one shared
-- `categories` table, no per-vendor scoping. Vendors could not create
-- categories visible only on their own storefront. This migration
-- extends the existing table with a nullable `vendor_id` column:
--
--   vendor_id IS NULL  → global category (admin / seeded, visible to
--                         every vendor and every customer)
--   vendor_id = $vid   → private category scoped to one vendor,
--                         visible only on that vendor's storefront and
--                         only in that vendor's admin
--
-- Slug uniqueness is split:
--   - Global slugs remain globally unique
--     `UNIQUE (slug) WHERE vendor_id IS NULL`
--   - Per-vendor slugs must be unique within the vendor
--     `UNIQUE (vendor_id, slug) WHERE vendor_id IS NOT NULL`
--
-- The migration also adds the missing FK from `vendor_products` to
-- `categories` so an admin's "delete category" action can't leave
-- orphaned product rows pointing at a vanished category.
--
-- A pre-flight query nulls out any orphaned `category_id` values
-- before the FK ALTER runs (defensive — current production data has
-- none, but the migration should still be safe to re-run).

-- (1) Add the nullable column + supporting index.
ALTER TABLE categories
  ADD COLUMN IF NOT EXISTS vendor_id UUID REFERENCES vendors(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_categories_vendor_id
  ON categories(vendor_id) WHERE vendor_id IS NOT NULL;

-- (2) Replace the global UNIQUE with two partial uniques.
--
-- The original constraint name is `categories_slug_key` (auto-named by
-- Postgres when 001_full_schema.sql declared `slug VARCHAR(100) UNIQUE
-- NOT NULL`). Drop it so we can re-declare uniqueness with partial
-- indexes instead.
ALTER TABLE categories DROP CONSTRAINT IF EXISTS categories_slug_key;

CREATE UNIQUE INDEX IF NOT EXISTS uq_categories_global_slug
  ON categories(slug) WHERE vendor_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_categories_vendor_slug
  ON categories(vendor_id, slug) WHERE vendor_id IS NOT NULL;

-- (3) Add the missing vendor_products.category_id FK.
--
-- Defensive: null any orphaned refs first so the ALTER doesn't fail.
-- The JOIN returns NULL when `c.id` is missing, so any row that points
-- at a non-existent category gets reset.
UPDATE vendor_products vp
   SET category_id = NULL
  FROM vendor_products vp_left
  LEFT JOIN categories c ON c.id = vp_left.category_id
 WHERE vp.id = vp_left.id
   AND vp_left.category_id IS NOT NULL
   AND c.id IS NULL;

ALTER TABLE vendor_products
  DROP CONSTRAINT IF EXISTS vendor_products_category_id_fkey;

ALTER TABLE vendor_products
  ADD CONSTRAINT vendor_products_category_id_fkey
  FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL;
