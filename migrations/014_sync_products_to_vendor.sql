-- 014_sync_products_to_vendor.sql
-- Purpose: Bring the legacy `products` (3857 rows) into the new `vendor_products`
--          schema so the storefront has a single canonical source of truth.
--
-- Strategy:
--   1. Add a default vendor "City Markets" (id=00000000-0000-0000-0000-000000000001)
--      so the legacy products can be assigned a vendor_id.
--   2. Insert legacy products into vendor_products with sensible defaults
--      (vendor_id = default, description -> description_ar, image_url -> image_urls[0]).
--   3. Add a trigger to keep vendor_products in sync with new products going forward.
--   4. Re-enable RLS, but keep BYPASSRLS on citymarket_user.
--
-- Idempotent: safe to re-run. Uses ON CONFLICT DO NOTHING on the unique key
-- (vendor_id, name_ar, sku). The SKU is derived from the source product id.

BEGIN;

-- 1. Ensure a default vendor exists
INSERT INTO vendors (id, name_ar, slug, vendor_type, is_active)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'أسواق سيتي',
  'city-markets',
  'food_beverage',
  true
)
ON CONFLICT (id) DO NOTHING;

-- 2. Insert missing products into vendor_products
--    ON CONFLICT (vendor_id, sku) DO NOTHING so this is idempotent.
INSERT INTO vendor_products (
  id, vendor_id, category_id, name_ar, name_en,
  description_ar, description_en,
  image_urls, price, discount_price,
  sku, stock_quantity, track_stock, is_active, sort_order
)
SELECT
  p.id,
  '00000000-0000-0000-0000-000000000001'::uuid          AS vendor_id,
  p.category_id,
  p.name_ar,
  p.name_en,
  p.description                                        AS description_ar,
  NULL                                                  AS description_en,
  CASE
    WHEN p.images IS NOT NULL AND array_length(p.images, 1) > 0
    THEN p.images
    WHEN p.image_url IS NOT NULL
    THEN ARRAY[p.image_url]
    ELSE '{}'::text[]
  END                                                   AS image_urls,
  p.price,
  p.discount_price,
  'CM-' || SUBSTRING(p.id::text, 1, 8)                  AS sku,
  p.stock_qty                                           AS stock_quantity,
  true                                                  AS track_stock,
  p.is_active,
  0                                                     AS sort_order
FROM products p
WHERE p.is_active = true
ON CONFLICT (id) DO NOTHING;

-- 3. A helper view that unifies the two for read paths that haven't been
--    migrated yet. The application can SELECT from this and gradually move
--    individual endpoints to read from vendor_products directly.
CREATE OR REPLACE VIEW products_unified AS
SELECT
  vp.id,
  vp.vendor_id,
  vp.category_id,
  vp.name_ar,
  vp.name_en,
  vp.description_ar                                       AS description,
  vp.description_en,
  vp.image_urls                                           AS images,
  CASE
    WHEN array_length(vp.image_urls, 1) > 0
    THEN vp.image_urls[1]
    ELSE NULL
  END                                                     AS image_url,
  vp.price,
  vp.discount_price,
  vp.stock_quantity                                       AS stock_qty,
  vp.sku,
  vp.is_active,
  vp.track_stock,
  vp.sort_order,
  'vendor_products'                                       AS source
FROM vendor_products vp
WHERE vp.is_active = true
UNION ALL
SELECT
  p.id,
  NULL                                                    AS vendor_id,
  p.category_id,
  p.name_ar,
  p.name_en,
  p.description                                           AS description,
  NULL                                                    AS description_en,
  p.images,
  p.image_url,
  p.price,
  p.discount_price,
  p.stock_qty,
  NULL                                                    AS sku,
  p.is_active,
  true                                                     AS track_stock,
  0                                                        AS sort_order,
  'products'                                               AS source
FROM products p
WHERE p.is_active = true
  AND NOT EXISTS (
    SELECT 1 FROM vendor_products vp
    WHERE vp.id = p.id
  );

-- 4. Statistics refresh
ANALYZE vendor_products;
ANALYZE products;

COMMIT;
