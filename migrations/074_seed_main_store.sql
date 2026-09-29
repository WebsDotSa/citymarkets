-- 074_seed_main_store.sql
-- Purpose: seed the City Markets HQ row in the `stores` table.
--
-- Why a dedicated migration (rather than appending to 002):
--   Migration 002 runs *before* migration 032 created the `stores`
--   table, so a stores INSERT in 002 fails on a fresh DB. Putting
--   the seed here (post-032) lets the chain apply cleanly without
--   reordering any existing migration.
--
-- Why this row is required:
--   /api/v1/delivery/quote (src/app/api/v1/delivery/quote/route.ts)
--   returns HTTP 503 with "لم يتم تهيئة موقع المتجر الرئيسي" when no
--   `is_main = true` row exists in `stores`. Without this seed the
--   qa:critical-paths gate fails on a fresh DB even though every
--   migration applied successfully — checkout cannot quote a
--   delivery fee and the cart→checkout transition dead-ends.
--
--   Production has had this row since before migration 032 created
--   the stores table; it was simply missing from the seed file. The
--   coordinates below point at Riyadh city center (King Fahd Rd /
--   Olaya St intersection). Operators can update them after first
--   deploy via the admin dashboard.

BEGIN;

INSERT INTO stores (name, name_ar, address, lat, lng, phone, is_active, is_main)
SELECT
  'City Markets HQ',
  'مقر سيتي ماركتس الرئيسي',
  'طريق الملك فهد، الرياض',
  24.7100000,
  46.6750000,
  '+966110000000',
  true,
  true
WHERE NOT EXISTS (
  SELECT 1 FROM stores WHERE is_main = true
);

COMMIT;
