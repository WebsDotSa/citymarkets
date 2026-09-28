-- Migration: Extend `vendor_products` with legacy columns for City Markets admin CRUD (Slice 4)
-- Date: 2026-08-01
--
-- Why:
--   Slice 4 makes the legacy `products` table read-only (migration 039) so the
--   admin product CRUD must write to `vendor_products` instead. But the two
--   schemas aren't a drop-in swap — `products` carries several columns the
--   marketplace schema dropped:
--
--     products                          vendor_products
--     --------------------------------  --------------------------------
--     barcode VARCHAR(50)               sku TEXT
--     description TEXT                  description_ar / description_en
--     image_url TEXT                    image_urls TEXT[]
--     unit TEXT DEFAULT 'piece'         (absent)
--     is_featured BOOLEAN               (absent)
--     stock_qty INTEGER                 stock_quantity INTEGER
--
--   This migration extends `vendor_products` with the 5 missing columns so the
--   admin route can do a near-drop-in swap. Column names mirror `products`
--   verbatim so the existing `productInputSchema` validation passes without
--   changes.
--
--   After this, `vendor_products` is a strict superset of the legacy
--   `products` row (plus the marketplace columns it already had). The admin
--   route reads can stay on `products` (still SELECT-allowed) or switch to
--   `products_unified`; either way writes land here.
--
-- All changes are idempotent and safe to re-run.

BEGIN;

-- 1. Barcode (legacy products.barcode VARCHAR(50) → here as TEXT to keep
-- space-compatibility with the admin form input)
ALTER TABLE vendor_products
  ADD COLUMN IF NOT EXISTS barcode TEXT;

-- 2. Free-form description (legacy products.description TEXT). Coexists with
-- description_ar / description_en; the admin form writes a single text blob
-- here (no Arabic/English split).
ALTER TABLE vendor_products
  ADD COLUMN IF NOT EXISTS description TEXT;

-- 3. Primary image URL (legacy products.image_url TEXT). Coexists with the
-- existing image_urls[] gallery — admin form writes the single primary URL,
-- vendor admin can use the array.
ALTER TABLE vendor_products
  ADD COLUMN IF NOT EXISTS image_url TEXT;

-- 4. Unit label (legacy products.unit TEXT DEFAULT 'piece'). Arabic default
-- matches what the admin form fills in when the field is empty.
ALTER TABLE vendor_products
  ADD COLUMN IF NOT EXISTS unit TEXT DEFAULT 'حبة';

-- 5. Featured flag for sort/marketing (legacy products.is_featured BOOLEAN).
ALTER TABLE vendor_products
  ADD COLUMN IF NOT EXISTS is_featured BOOLEAN DEFAULT FALSE NOT NULL;

-- Same barcode index legacy `products` had for cashier lookups.
CREATE INDEX IF NOT EXISTS idx_vendor_products_barcode
  ON vendor_products(barcode) WHERE barcode IS NOT NULL;

-- Same featured index for the homepage carousel.
CREATE INDEX IF NOT EXISTS idx_vendor_products_featured
  ON vendor_products(is_featured) WHERE is_featured = TRUE;

-- Stock column doesn't need a rename (the existing `stock_quantity` is fine
-- for new vendors); the admin route continues to use `stock_qty` in user
-- input but writes to `stock_quantity` in SQL.
--
-- All admin product write paths can now target `vendor_products` with the
-- same column set they used on `products`. Read paths can stay on `products`
-- (still SELECT-allowed) or move to `products_unified` for free.

COMMIT;
