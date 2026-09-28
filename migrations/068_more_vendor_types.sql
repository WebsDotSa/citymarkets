-- 068_more_vendor_types.sql
-- Purpose:
--   Expand `vendors.vendor_type` CHECK constraint with 10 additional
--   categories requested by the operator (electronic + adjacent
--   verticals that don't fit the existing 13 buckets).
--
-- Categories added (Arabic label mappings live in src/lib/vendors.ts
-- and src/lib/vendor-types.ts — keep both lists in sync when adding
-- or renaming):
--
--   home_appliances       — أجهزة منزلية
--   furniture_home        — أثاث وديكور منزل
--   jewelry_watches       — مجوهرات وساعات
--   cars_auto             — سيارات ومستلزمات
--   pets_animals          — حيوانات أليفة ومستلزماتها
--   kids_babies           — أطفال ورُضع
--   music_instruments     — موسيقى وآلات
--   tools_industrial      — عدد ومستلزمات صناعية
--   travel_tourism        — سفر وسياحة
--   real_estate           — عقارات
--
-- Idempotency: ALTER ... DROP CONSTRAINT IF EXISTS + ADD CONSTRAINT
-- pattern, safe to re-run.

BEGIN;

ALTER TABLE vendors DROP CONSTRAINT IF EXISTS vendors_vendor_type_check;

ALTER TABLE vendors
  ADD CONSTRAINT vendors_vendor_type_check CHECK (vendor_type IN (
    -- legacy / existing categories
    'food_beverage', 'fashion', 'gifts', 'electronics', 'services',
    -- categories from migration 063
    'grocery_supermarket', 'restaurant_cafe', 'sweets_bakery', 'pharmacy_health',
    'beauty_cosmetics', 'flowers_plants', 'books_stationery', 'sports_fitness',
    -- new categories (this migration)
    'home_appliances',
    'furniture_home',
    'jewelry_watches',
    'cars_auto',
    'pets_animals',
    'kids_babies',
    'music_instruments',
    'tools_industrial',
    'travel_tourism',
    'real_estate'
  ));

DO $$
DECLARE
  total_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO total_count FROM vendors;
  RAISE NOTICE '[068] vendors.vendor_type CHECK expanded to % categories. % vendor rows unaffected.',
    23, total_count;
END $$;

COMMIT;