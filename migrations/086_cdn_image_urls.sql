-- ════════════════════════════════════════════════════════════════════════════
-- 086 — Rewrite legacy /images/* image URLs to the R2 CDN
-- ════════════════════════════════════════════════════════════════════════════
--
-- Why:
--   After the 2026-08-17 R2 migration, all catalog images live on the
--   `r2:citymarkets` bucket, served via `https://cdn.citymarkets.sa/...`.
--   The `/public/images/{products,vendor,banners,categories,...}` directories
--   no longer exist on disk (verified — empty after build).
--
--   Migration 043_category_product_images.sql (the one that picked category
--   icons by matching each category to a real product image) wrote absolute
--   local paths like `icon_url = '/images/products/8656fb69fd85.jpg'` into
--   `categories.icon_url`. Without rewriting those paths the browser hits
--   `https://citymarkets.sa/images/products/<hash>.jpg` → 404 → broken
--   image icon (the symptom seen on /categories on 2026-10-08).
--
--   Same pattern affects `vendors.logo_url` / `banner_url`, the source
--   tables behind `products_unified` (`vendor_products`, `products`),
--   `offers.image_url`, and `vendor_locations.brand_image_url`.
--   Note: `products_unified` is a VIEW that UNIONs `vendor_products` and
--   `products` (migration 014 + 052), so we write to the source tables
--   instead.
--
-- Rewrite rule:
--   /images/<bucket>/<file>  →  https://cdn.citymarkets.sa/<bucket>/<file>
--
-- Buckets preserved (products/, banners/, vendor/, categories/, offers/,
-- uploads/, place-images/). The CDN mirrors the R2 key layout, so the
-- only change required is the host + protocol prefix.
--
-- Safety:
--   • Each UPDATE is guarded by `LIKE '/images/%'` so rows that already
--     point at the CDN (post-053 product uploads wrote the full CDN URL)
--     are untouched.
--   • The migration is idempotent: re-running is a no-op because nothing
--     matches `/images/%` after the first run.
--   • NO row is deleted or dropped — only string column values are
--     rewritten.
--
-- Rollback:
--   UPDATE <table> SET col = REPLACE(col, 'https://cdn.citymarkets.sa/', '/images/')
--    WHERE col LIKE 'https://cdn.citymarkets.sa/%';
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ──────────────────────────────────────────────────────────────────────────
-- 1) categories.icon_url
-- ──────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  updated_cats INT := 0;
BEGIN
  UPDATE categories
     SET icon_url = 'https://cdn.citymarkets.sa/' || SUBSTRING(icon_url FROM 9)
   WHERE icon_url LIKE '/images/%';
  GET DIAGNOSTICS updated_cats = ROW_COUNT;
  RAISE NOTICE '[086] categories.icon_url: % rows rewritten', updated_cats;
END $$;

-- ──────────────────────────────────────────────────────────────────────────
-- 2) vendors.logo_url + vendors.banner_url
-- ──────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  updated_logos   INT := 0;
  updated_banners INT := 0;
BEGIN
  UPDATE vendors
     SET logo_url = 'https://cdn.citymarkets.sa/' || SUBSTRING(logo_url FROM 9)
   WHERE logo_url LIKE '/images/%';
  GET DIAGNOSTICS updated_logos = ROW_COUNT;
  RAISE NOTICE '[086] vendors.logo_url: % rows rewritten', updated_logos;

  UPDATE vendors
     SET banner_url = 'https://cdn.citymarkets.sa/' || SUBSTRING(banner_url FROM 9)
   WHERE banner_url LIKE '/images/%';
  GET DIAGNOSTICS updated_banners = ROW_COUNT;
  RAISE NOTICE '[086] vendors.banner_url: % rows rewritten', updated_banners;
END $$;

-- ──────────────────────────────────────────────────────────────────────────
-- 3) vendor_products.image_url + image_urls[]  (branch A of products_unified)
-- ──────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  updated_image_url    INT := 0;
  updated_image_urls_a INT := 0;
BEGIN
  UPDATE vendor_products
     SET image_url = 'https://cdn.citymarkets.sa/' || SUBSTRING(image_url FROM 9)
   WHERE image_url LIKE '/images/%';
  GET DIAGNOSTICS updated_image_url = ROW_COUNT;
  RAISE NOTICE '[086] vendor_products.image_url: % rows rewritten', updated_image_url;

  -- image_urls[] is text[] — replace any element starting with /images/.
  UPDATE vendor_products AS p
     SET image_urls = COALESCE(ARRAY(
       SELECT CASE
                WHEN url LIKE '/images/%'
                  THEN 'https://cdn.citymarkets.sa/' || SUBSTRING(url FROM 9)
                ELSE url
              END
         FROM UNNEST(p.image_urls) AS url
     ), '{}')
   WHERE EXISTS (
     SELECT 1 FROM UNNEST(image_urls) AS url WHERE url LIKE '/images/%'
   );
  GET DIAGNOSTICS updated_image_urls_a = ROW_COUNT;
  RAISE NOTICE '[086] vendor_products.image_urls[]: % rows rewritten',
    updated_image_urls_a;
END $$;

-- ──────────────────────────────────────────────────────────────────────────
-- 4) products.image_url + images  (branch B of products_unified — legacy)
-- ──────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  updated_p_image_url  INT := 0;
  updated_p_images     INT := 0;
BEGIN
  UPDATE products
     SET image_url = 'https://cdn.citymarkets.sa/' || SUBSTRING(image_url FROM 9)
   WHERE image_url LIKE '/images/%';
  GET DIAGNOSTICS updated_p_image_url = ROW_COUNT;
  RAISE NOTICE '[086] products.image_url: % rows rewritten', updated_p_image_url;

  UPDATE products AS p
     SET images = COALESCE(ARRAY(
       SELECT CASE
                WHEN url LIKE '/images/%'
                  THEN 'https://cdn.citymarkets.sa/' || SUBSTRING(url FROM 9)
                ELSE url
              END
         FROM UNNEST(p.images) AS url
     ), '{}')
   WHERE EXISTS (
     SELECT 1 FROM UNNEST(images) AS url WHERE url LIKE '/images/%'
   );
  GET DIAGNOSTICS updated_p_images = ROW_COUNT;
  RAISE NOTICE '[086] products.images[]: % rows rewritten', updated_p_images;
END $$;

-- ──────────────────────────────────────────────────────────────────────────
-- 5) offers.image_url (cover image for the offer card)
-- ──────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  updated_offers INT := 0;
BEGIN
  UPDATE offers
     SET image_url = 'https://cdn.citymarkets.sa/' || SUBSTRING(image_url FROM 9)
   WHERE image_url LIKE '/images/%';
  GET DIAGNOSTICS updated_offers = ROW_COUNT;
  RAISE NOTICE '[086] offers.image_url: % rows rewritten', updated_offers;
END $$;

-- ──────────────────────────────────────────────────────────────────────────
-- 6) vendor_locations.brand_image_url (defensive — only if column exists)
-- ──────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  updated_vl INT := 0;
  has_col    BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'vendor_locations'
       AND column_name = 'brand_image_url'
  ) INTO has_col;

  IF has_col THEN
    EXECUTE $sql$
      UPDATE vendor_locations
         SET brand_image_url = 'https://cdn.citymarkets.sa/' || SUBSTRING(brand_image_url FROM 9)
       WHERE brand_image_url LIKE '/images/%'
    $sql$;
    GET DIAGNOSTICS updated_vl = ROW_COUNT;
    RAISE NOTICE '[086] vendor_locations.brand_image_url: % rows rewritten', updated_vl;
  ELSE
    RAISE NOTICE '[086] vendor_locations.brand_image_url: column not present, skipping';
  END IF;
END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- Sanity guard: report any remaining /images/* rows so the deployer can
-- decide whether to follow up.
-- ════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  leftover INT;
BEGIN
  SELECT COUNT(*) INTO leftover
    FROM (
      SELECT icon_url     AS url FROM categories        WHERE icon_url LIKE '/images/%'
      UNION ALL
      SELECT logo_url     AS url FROM vendors           WHERE logo_url LIKE '/images/%'
      UNION ALL
      SELECT banner_url   AS url FROM vendors           WHERE banner_url LIKE '/images/%'
      UNION ALL
      SELECT image_url    AS url FROM vendor_products   WHERE image_url LIKE '/images/%'
      UNION ALL
      SELECT url          AS url FROM vendor_products, UNNEST(image_urls) url
                                                   WHERE url LIKE '/images/%'
      UNION ALL
      SELECT image_url    AS url FROM products          WHERE image_url LIKE '/images/%'
      UNION ALL
      SELECT url          AS url FROM products, UNNEST(images) url
                                                   WHERE url LIKE '/images/%'
      UNION ALL
      SELECT image_url    AS url FROM offers            WHERE image_url LIKE '/images/%'
    ) s;
  RAISE NOTICE '[086] post-migration leftover /images/* rows: %', leftover;
END $$;

COMMIT;
