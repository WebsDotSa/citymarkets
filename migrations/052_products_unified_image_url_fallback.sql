-- Migration: Make `products_unified.image_url` fall back to
-- `vendor_products.image_url` when the gallery array is empty/null.
-- Date: 2026-08-24
--
-- ============================================================
-- OPERATOR NOTE — view ownership
-- ============================================================
-- `CREATE OR REPLACE VIEW` requires the caller to own the view OR
-- have CREATE privilege on the schema. The default runner connects
-- as `citymarket_user` (BYPASSRLS but not view owner). If applying
-- manually and the view already exists, connect as the view owner
-- (typically `postgres`) before running this script.
-- ============================================================
--
-- Why:
--   Migration 039c refreshes the view to read `barcode`, `unit`,
--   `is_featured` from real columns (added in 039b). For `image_url` it
--   keeps the original 036 semantics: take the first element of the
--   `image_urls[]` gallery.
--
--   The admin product form (`src/app/api/admin/products/route.ts`) writes
--   the primary image to the `image_url` TEXT column only — it does NOT
--   push that URL into the `image_urls[]` gallery when the admin uploads
--   a single image (the gallery field is separate). Result: a freshly
--   created product row has `image_url = 'https://cdn.citymarkets.sa/...'`
--   but `image_urls[] = NULL`, so the view returns NULL.
--
--   Test reproduction (2026-08-24):
--     POST /api/admin/products → 201, id = e0ce4695-...
--     POST /api/admin/upload    → R2 URL https://cdn.citymarkets.sa/products/1787586225280_9a296e5c.png
--     GET  /api/admin/products/[id]
--       → { ..., "image_url": null, "images": [] }
--
--   Fix: COALESCE the array element with `vp.image_url`. If both are
--   populated, prefer the array (preserves 036 contract). If only the
--   single column is populated (admin path), fall back to it.
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
  -- image_url: prefer first element of image_urls[] (036 contract),
  -- fall back to the dedicated image_url column for rows that only
  -- populate the single-image column (admin POST/PUT path).
  COALESCE(
    NULLIF(vp.image_urls[1], ''),
    NULLIF(vp.image_url, '')
  )                                                             AS image_url,
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
-- IDENTICAL to migration 039c — branch B already reads `p.image_url`
-- directly so this fix only affects branch A.
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

-- 3. Refresh planner stats so the first request after the view change
--    doesn't suffer a cold-plan penalty.
ANALYZE vendor_products;
ANALYZE products;

COMMIT;