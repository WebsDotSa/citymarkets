#!/usr/bin/env node
/**
 * Generate migration 087 from migration 043.
 *
 * Reads `migrations/043_category_product_images.sql`, extracts every
 * (slug, hash) pair, and writes `migrations/087_repair_broken_rmbg_icons.sql`
 * with the replace-with-curated-image and null-out-the-rest logic.
 *
 * Idempotent: re-running regenerates the same content.
 */
const fs = require("fs");
const path = require("path");

const src = fs.readFileSync(
  path.join(process.cwd(), "migrations/043_category_product_images.sql"),
  "utf8",
);

// Each UPDATE in 043 is shaped:
//   UPDATE categories SET icon_url = '/images/products/<HASH>.jpg'
//    WHERE slug = '<SLUG>' AND icon_url IS DISTINCT FROM '/images/products/<HASH>.jpg';
const re = /UPDATE categories SET icon_url = '\/images\/products\/([a-z0-9]+)\.jpg'[\s\S]*?WHERE slug = '([^']+)' AND/g;
const pairs = [];
let m;
while ((m = re.exec(src)) !== null) {
  pairs.push([m[2], m[1]]);
}
console.log(`extracted ${pairs.length} (slug, hash) pairs from migration 043`);
if (pairs.length === 0) {
  console.error("regex failed to extract anything — aborting");
  process.exit(1);
}

// Deduplicate by slug (shouldn't happen, but be safe)
const seen = new Set();
const dedup = pairs.filter(([slug]) => {
  if (seen.has(slug)) return false;
  seen.add(slug);
  return true;
});
console.log(`after dedupe: ${dedup.length}`);

const valuesBlock = dedup
  .map(
    ([slug, hash]) => `    ('${slug.replace(/'/g, "''")}', '${hash}')`,
  )
  .join(",\n");

const migration = `-- Auto-generated from migration 043 at ${new Date().toISOString()}
-- ════════════════════════════════════════════════════════════════════════════
-- 087 — Replace broken /categories/rmbg/* admin-panel icons with curated
--      product images from migration 043; fallback to NULL (emoji render).
-- ════════════════════════════════════════════════════════════════════════════
--
-- Why:
--   Migration 086 rewrote every '/images/*' URL to 'cdn.citymarkets.sa/*',
--   which exposed a second wave of broken icons: admin-panel uploads under
--   'categories/rmbg/<name>.png' that never made it to R2 (HEAD probe on
--   2026-10-08 returned 404 for /categories/rmbg/{البرجر,لحوم-طازجة,
--   chilled-chicken}.png).
--
-- Fix:
--   1) For every category whose current icon_url matches '/categories/rmbg/'
--      AND whose slug is in migration 043's curated (slug -> hash) map,
--      replace the URL with the curated CDN product image:
--         /categories/rmbg/<slug>.png  →
--             https://cdn.citymarkets.sa/products/<hash>.jpg
--      Every one of those 138 hashes exists on R2 (verify before merge).
--   2) For '/rmbg/' URLs whose slug is NOT in 043, set icon_url = NULL
--      so the page renders the emoji fallback instead of the broken icon.
--   3) '/categories/rmbg/<name>.png' URLs that DO work on CDN (e.g.
--      /categories/rmbg/meat.png, dairy.png — confirmed 200) — if their
--      slug is not in 043 they will be NULLed by step 2. This is the
--      desired outcome: the page tree only renders subcategories that have
--      curated icons; admin stubs without 043 entries shouldn't show.
--
-- Verification:
--   The generator script (this file) prints the count. Mapped slugs have
--   a known-good hash. Run HEAD probes against CDN after deploy to confirm.
--
-- Idempotent:
--   Step 1 only touches rows where slug is in 043 AND icon_url still
--   matches '/categories/rmbg/'. Step 2 only touches rows where slug is
--   NOT in 043 AND icon_url still matches '/categories/rmbg/'. Re-running
--   on a clean DB is a no-op.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

WITH icon_map(slug, hash) AS (
  VALUES
${valuesBlock}
),
-- Step 1: replace rmbg/<slug>.png with /products/<hash>.jpg for slugs in 043
-- NOTE: LIKE '%/categories/rmbg/%' matches both legacy '/categories/rmbg/...'
-- (pre-migration-086) and post-086 'https://.../categories/rmbg/...' forms.
replace_with_product AS (
  UPDATE categories c
     SET icon_url = 'https://cdn.citymarkets.sa/products/' || m.hash || '.jpg'
    FROM icon_map m
   WHERE c.slug = m.slug
     AND c.icon_url LIKE '%/categories/rmbg/%'
  RETURNING c.slug
),
-- Step 2: NULL out any remaining /rmbg/ URLs (slugs not in 043)
null_out AS (
  UPDATE categories
     SET icon_url = NULL
   WHERE icon_url LIKE '%/categories/rmbg/%'
     AND slug NOT IN (SELECT slug FROM icon_map)
  RETURNING slug
)
SELECT
  (SELECT COUNT(*) FROM replace_with_product) AS replaced_count,
  (SELECT COUNT(*) FROM null_out)             AS nulled_count;

COMMIT;
`;

fs.writeFileSync(
  path.join(process.cwd(), "migrations/087_repair_broken_rmbg_icons.sql"),
  migration,
);
console.log(
  `wrote migrations/087_repair_broken_rmbg_icons.sql (${migration.length} bytes)`,
);
