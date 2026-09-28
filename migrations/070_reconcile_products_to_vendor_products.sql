-- 070_reconcile_products_to_vendor_products.sql
-- Purpose: Make vendor_products the single source of truth for catalog
--          stock/price. Mirror any `products` rows that are missing from
--          `vendor_products` under CITY_MARKETS_VENDOR_ID, and sync stock
--          + price on overlap rows.
--
-- Why now (Phase 1 / T5):
--   T0 (2026-09-28) confirmed 88 active `products` rows with no
--   `vendor_products` twin, and 1154 overlap rows where stock_quantity or
--   price drifted. Checkout's stock decrement at
--   src/lib/checkout/create-checkout.ts:337-358 only writes
--   vendor_products.stock_quantity, so for the 88 orphan rows the UPDATE
--   silently affected zero rows — the customer-facing decrement never
--   happened. After this migration, every catalog product will have a
--   vendor_products row with track_stock = true so checkout's decrement
--   will work.
--
-- Idempotency: ON CONFLICT (id) DO NOTHING on the vendor_products PK.
--   The sync UPDATE has explicit predicates so re-runs no-op. The
--   migration is wrapped in BEGIN/COMMIT to match the project's
--   migration conventions (014, 036, 039b).

BEGIN;

-- 1. Mirror missing products into vendor_products under CITY_MARKETS_VENDOR_ID.
--    Pattern mirrors migration 014's backfill but uses ON CONFLICT (id)
--    (vendor_products.id is the PK, not the (vendor_id, sku) pair 014 used).
INSERT INTO vendor_products (
  id, vendor_id, category_id, name_ar, name_en,
  description_ar, image_urls, price, discount_price,
  sku, stock_quantity, track_stock, is_active, sort_order
)
SELECT
  p.id,
  '00000000-0000-0000-0000-000000000001'::uuid AS vendor_id,
  p.category_id,
  p.name_ar,
  p.name_en,
  p.description                                  AS description_ar,
  CASE
    WHEN p.images IS NOT NULL AND array_length(p.images, 1) > 0
      THEN p.images
    WHEN p.image_url IS NOT NULL
      THEN ARRAY[p.image_url]
    ELSE '{}'::text[]
  END                                            AS image_urls,
  p.price,
  p.discount_price,
  'CM-' || SUBSTRING(p.id::text, 1, 8)           AS sku,
  p.stock_qty                                    AS stock_quantity,
  true                                           AS track_stock,
  p.is_active,
  0                                              AS sort_order
FROM products p
WHERE p.is_active = true
  AND NOT EXISTS (
    SELECT 1 FROM vendor_products vp WHERE vp.id = p.id
  )
ON CONFLICT (id) DO NOTHING;

-- 2. Sync stock + price on overlap rows for the City Markets catalog.
--    products is read-only post-migration 039, so any drift must come
--    from a one-off DB-level UPDATE an operator ran outside the app.
--    Defensive — keeps vendor_products as the single writer.
UPDATE vendor_products vp
   SET stock_quantity = p.stock_qty,
       price          = p.price,
       updated_at     = NOW()
  FROM products p
 WHERE p.id = vp.id
   AND vp.vendor_id = '00000000-0000-0000-0000-000000000001'
   AND (vp.stock_quantity <> p.stock_qty OR vp.price <> p.price);

-- 3. Audit.
DO $$
DECLARE
  unmirrored INTEGER;
  divergent  INTEGER;
BEGIN
  SELECT COUNT(*) INTO unmirrored
    FROM products p
   WHERE p.is_active = true
     AND NOT EXISTS (SELECT 1 FROM vendor_products vp WHERE vp.id = p.id);

  SELECT COUNT(*) INTO divergent
    FROM vendor_products vp
    JOIN products p ON p.id = vp.id
   WHERE vp.vendor_id = '00000000-0000-0000-0000-000000000001'
     AND (vp.stock_quantity <> p.stock_qty OR vp.price <> p.price);

  RAISE NOTICE '[070] reconciliation: % active products still without vendor_products twin; % rows still drifted',
    unmirrored, divergent;
END $$;

ANALYZE vendor_products;
ANALYZE products;

COMMIT;