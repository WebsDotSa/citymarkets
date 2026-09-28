-- Migration: Refresh `products_unified` to read barcode/unit/is_featured
-- from the new real columns added in 039b (not metadata JSONB)
-- Date: 2026-08-01
--
-- Why:
--   Migration 039b added real columns `barcode`, `unit`, `is_featured`,
--   `image_url`, `description` to `vendor_products`. Before 039b, the
--   `products_unified` view (migration 036) read `barcode`, `unit`,
--   `is_featured` from `metadata` JSONB because those columns didn't exist
--   as first-class columns.
--
--   After 039b the admin writes to real columns (the schema is a strict
--   superset of legacy `products`). If the view keeps reading metadata,
--   `products_unified.barcode` will be NULL for newly-created rows, which
--   breaks cashier barcode scans and the search-by-barcode flow.
--
--   This migration uses `CREATE OR REPLACE VIEW` (preserves column order
--   + types + permissions) and only changes the three branch-A accesses
--   to read from the new columns with a COALESCE fallback to the legacy
--   metadata rows. Branch B (legacy `products`) is untouched — it already
--   reads the right columns.
--
-- Idempotent: CREATE OR REPLACE is a no-op when the definition hasn't
-- changed, and the column set is preserved.

BEGIN;

CREATE OR REPLACE VIEW products_unified AS

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
  -- image_url: first image from the array (kept identical to 036)
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
  -- 039b: read barcode from the new real column; pre-039b rows had it in
  -- metadata JSONB. The COALESCE keeps both worlds working.
  COALESCE(NULLIF(vp.barcode, ''), vp.metadata->>'barcode')     AS barcode,
  -- 039b: read unit from the real column with metadata fallback.
  COALESCE(NULLIF(vp.unit, ''), vp.metadata->>'unit', 'piece')  AS unit,
  -- 039b: read is_featured from the real column with metadata fallback.
  COALESCE(vp.is_featured, (vp.metadata->>'is_featured')::boolean, false)
                                                                 AS is_featured,
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
-- IDENTICAL to migration 036 — leave untouched. Pre- and post-039b
-- legacy rows have the right shape as first-class columns on `products`.
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
