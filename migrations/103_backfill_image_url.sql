-- ══════════════════════════════════════════════════════════════
-- 103 — Backfill image_url from image_urls array
--
-- 2,309 of 4,879 vendor_products rows have an empty `image_url`
-- column but `image_urls` (a TEXT[]) contains one or more URLs.
-- This is leftover from the catalog refactor where image_url was
-- promoted to an array to support multi-image products, but
-- the singular column was never backfilled for existing rows.
--
-- Storefront + admin list pages read `image_url` directly; the
-- array fallback `COALESCE(NULLIF(image_url,''), image_urls[1])`
-- works in most API routes but the React components that render
-- `<img src={product.image_url}>` end up with a 404 because the
-- raw `image_url` field is empty.
--
-- Fix: copy image_urls[1] into image_url when image_url is empty.
-- Idempotent — re-running changes nothing once the rows are
-- populated.
-- ══════════════════════════════════════════════════════════════

BEGIN;

UPDATE vendor_products
   SET image_url = image_urls[1]
 WHERE (image_url IS NULL OR image_url = '')
   AND image_urls IS NOT NULL
   AND array_length(image_urls, 1) > 0;

COMMIT;
