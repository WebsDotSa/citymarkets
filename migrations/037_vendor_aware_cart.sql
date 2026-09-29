-- 037_vendor_aware_cart.sql
-- Purpose: Make `cart` and `guest_cart` vendor-aware so a single cart can
--          hold both City Markets catalog items (owner =
--          CITY_MARKETS_VENDOR_ID = '00000000-0000-0000-0000-000000000001')
--          and items from third-party vendors (owner = the vendor's UUID).
--          Slice 3 (multi-vendor checkout) splits the order per vendor at
--          POST /api/v1/checkout time; this migration only widens the
--          cart schema to carry the identity it needs.
--
-- Strategy:
--   1. Drop the FK on product_id → products(id) because new vendor
--      products get fresh UUIDs that don't exist in the legacy `products`
--      table (migration 014 only backfilled the OLD catalog into
--      vendor_products — it didn't INSERT new vendor-only rows into
--      products). The cart API validates product existence in the
--      appropriate table (products_unified view) at insert time.
--   2. Add a nullable `vendor_id` column referencing `vendors(id)`. ON
--      DELETE SET NULL so removing a vendor empties that vendor's cart
--      items instead of cascading the whole cart away.
--   3. Replace the (user_id, product_id) / (session_id, product_id)
--      UNIQUE constraint with a vendor-aware partial unique index that
--      treats NULL vendor_id as the City Markets pseudo-vendor. PostgreSQL
--      considers NULLs distinct in UNIQUE constraints by default, so we
--      COALESCE the column to the City Markets UUID for the index key —
--      otherwise two rows for the same product + user could coexist
--      (one without vendor, one with), which is exactly the kind of
--      duplicate that produces negative cart totals at checkout.
--   4. Index `vendor_id` so Slice 3's per-vendor cart reload is cheap.
--
-- Safe to re-run: every operation is idempotent (IF EXISTS / DROP IF
-- EXISTS / CREATE ... IF NOT EXISTS).

BEGIN;

-- 1a. Drop the FK on cart.product_id → products(id).
ALTER TABLE cart DROP CONSTRAINT IF EXISTS cart_product_id_fkey;

-- 1b. Drop the FK on guest_cart.product_id → products(id).
ALTER TABLE guest_cart DROP CONSTRAINT IF EXISTS guest_cart_product_id_fkey;

-- 2. Add the vendor_id columns. Nullable so existing rows are
--    preserved (treated as City Markets catalog items by the cart
--    context's normalization step).
ALTER TABLE cart
  ADD COLUMN IF NOT EXISTS vendor_id UUID REFERENCES vendors(id) ON DELETE SET NULL;

ALTER TABLE guest_cart
  ADD COLUMN IF NOT EXISTS vendor_id UUID REFERENCES vendors(id) ON DELETE SET NULL;

-- 3a. Replace cart's UNIQUE with a vendor-aware partial unique index.
-- Expression must match the application's ON CONFLICT clause
-- (src/app/api/v1/cart/route.ts) byte-for-byte modulo trivial casts.
-- The application writes `COALESCE(vendor_id, '<UUID>')` with no
-- explicit cast; an index expression using `::uuid` on the literal
-- is treated by PostgreSQL as a *different* expression and ON
-- CONFLICT inference fails with "there is no unique or exclusion
-- constraint matching the ON CONFLICT specification". Keeping the
-- cast off the index side keeps the inference working.
ALTER TABLE cart DROP CONSTRAINT IF EXISTS cart_user_id_product_id_key;
ALTER TABLE cart DROP CONSTRAINT IF EXISTS cart_user_product_unique;

CREATE UNIQUE INDEX IF NOT EXISTS cart_user_product_vendor_uniq
  ON cart (user_id, product_id, COALESCE(vendor_id, '00000000-0000-0000-0000-000000000001'))
  WHERE product_id IS NOT NULL;

-- 3b. Same for guest_cart.
ALTER TABLE guest_cart DROP CONSTRAINT IF EXISTS guest_cart_session_product_unique;
ALTER TABLE guest_cart DROP CONSTRAINT IF EXISTS guest_cart_session_id_product_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS guest_cart_session_product_vendor_uniq
  ON guest_cart (session_id, product_id, COALESCE(vendor_id, '00000000-0000-0000-0000-000000000001'))
  WHERE product_id IS NOT NULL;

-- 4. Index vendor_id for Slice 3's per-vendor grouping at checkout time.
CREATE INDEX IF NOT EXISTS idx_cart_vendor ON cart(vendor_id) WHERE vendor_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_guest_cart_vendor ON guest_cart(vendor_id) WHERE vendor_id IS NOT NULL;

COMMIT;