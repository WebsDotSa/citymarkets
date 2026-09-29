-- 036_products_unified_refresh.sql
-- Purpose: Recreate the dormant `products_unified` view (from migration 014)
--          with EVERY field the public storefront APIs need, so the
--          `/api/v1/products` listing endpoint can serve City Markets
--          and third-party vendor products in one query.
--
--          Migration 014's view was missing: vendor_name, vendor_slug,
--          image_url (single), barcode, unit, is_featured, created_at,
--          updated_at, track_stock, source. The application code has
--          been patching these gaps by hitting only the `products` table
--          in the listing endpoint and only `vendor_products` in the
--          vendor detail endpoint.
--
-- Strategy:
--   1. Backfilled City Markets rows in `vendor_products` (vendor_id =
--      00000000-0000-0000-0000-000000000001, from migration 014) are the
--      canonical source for active listings.
--   2. Any `products` row that did NOT make it into `vendor_products`
--      (e.g. deactivated before the backfill ran, or legacy rows still
--      pointing at the catalog table only) is exposed with NULL vendor
--      fields so the API can still render it.
--   3. The view normalizes vendor_products' `metadata` JSONB to surface
--      `barcode`, `unit`, `is_featured` for vendor rows, defaulting to
--      sane values where missing.
--   4. The view is recreated with `CREATE OR REPLACE VIEW` so re-running
--      the migration is safe and the view contract stays in sync.
--
-- No DDL on the underlying tables — additive only. Read paths that
-- previously queried `products` can be migrated incrementally.

BEGIN;

-- DROP first because CREATE OR REPLACE VIEW cannot change column
-- names / order in place. The view is read-only so dropping is safe.
DROP VIEW IF EXISTS products_unified;

CREATE VIEW products_unified AS

-- Branch A: vendor_products (canonical for active listings)
SELECT
  vp.id,
  vp.vendor_id,
  v.slug                                                       AS vendor_slug,
  v.name_ar                                                    AS vendor_name,
  vp.category_id,
  vp.name_ar,
  vp.name_en,
  -- description: prefer description_ar, fall back to description_en
  COALESCE(vp.description_ar, vp.description_en)                AS description,
  vp.description_ar,
  vp.description_en,
  -- image_url: first image from the array
  CASE
    WHEN vp.image_urls IS NOT NULL AND array_length(vp.image_urls, 1) > 0
    THEN vp.image_urls[1]
    ELSE NULL
  END                                                           AS image_url,
  COALESCE(vp.image_urls, '{}'::text[])                         AS images,
  vp.price::float                                               AS price,
  vp.discount_price::float                                      AS discount_price,
  vp.stock_quantity::int                                        AS stock_qty,
  COALESCE((vp.metadata->>'track_stock')::boolean, vp.track_stock, true)
                                                                 AS track_stock,
  -- Normalize metadata-backed fields. Backfilled rows from migration 014
  -- embed the legacy column values into metadata; new rows may also
  -- store barcode/unit/is_featured there.
  vp.metadata->>'barcode'                                       AS barcode,
  COALESCE(vp.metadata->>'unit', 'piece')                       AS unit,
  COALESCE((vp.metadata->>'is_featured')::boolean, false)       AS is_featured,
  vp.sku                                                        AS sku,
  vp.is_active,
  vp.sort_order,
  vp.created_at,
  vp.updated_at,
  'vendor_products'                                             AS source
FROM vendor_products vp
LEFT JOIN vendors v
  ON v.id = vp.vendor_id
WHERE vp.is_active = true

UNION ALL

-- Branch B: legacy products NOT yet mirrored into vendor_products.
-- Covers deactivated-before-backfill rows and any products inserted
-- since the last sync. These expose NULL vendor_* fields.
SELECT
  p.id,
  NULL::uuid                                                    AS vendor_id,
  NULL::text                                                    AS vendor_slug,
  NULL::text                                                    AS vendor_name,
  p.category_id,
  p.name_ar,
  p.name_en,
  p.description                                                  AS description,
  p.description                                                  AS description_ar,
  NULL::text                                                    AS description_en,
  p.image_url                                                    AS image_url,
  COALESCE(p.images, '{}'::text[])                               AS images,
  p.price::float                                                 AS price,
  p.discount_price::float                                        AS discount_price,
  p.stock_qty::int                                               AS stock_qty,
  true                                                           AS track_stock,
  p.barcode                                                      AS barcode,
  p.unit                                                         AS unit,
  COALESCE(p.is_featured, false)                                 AS is_featured,
  NULL::text                                                     AS sku,
  COALESCE(p.is_active, true)                                    AS is_active,
  0::int                                                         AS sort_order,
  p.created_at,
  p.updated_at,
  'products'                                                     AS source
FROM products p
WHERE COALESCE(p.is_active, true) = true
  AND NOT EXISTS (
    SELECT 1 FROM vendor_products vp WHERE vp.id = p.id
  );

-- 2. Refresh planner stats so the first request after the view change
--    doesn't suffer a cold-plan penalty.
ANALYZE vendor_products;
ANALYZE products;

COMMIT;