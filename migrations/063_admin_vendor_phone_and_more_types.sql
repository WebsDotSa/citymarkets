-- 063_admin_vendor_phone_and_more_types.sql
-- Purpose:
--   * Add `phone` column to `admin_users` and `vendor_staff` so admins and
--     merchant owners can sign in with a phone number.
--   * Replace the `vendors.vendor_type` CHECK constraint with a richer
--     enum of merchant categories (groceries, restaurants, pharmacies…).
--   * Lowercase unique indexes on phone so login-by-phone is fast and
--     case-insensitive regardless of how the value was sent.
--
-- Backwards-compat notes:
--   * phone is added NULL-allowed on purpose — existing admin/vendor
--     rows may not have one. The application-level validation in
--     /api/admin/admin-users and /api/admin/vendors is the
--     authoritative gate for *new* staff entries. Once backfilled,
--     promote to NOT NULL in a follow-up migration if desired.
--   * CHECK replacement uses a transaction; if any row currently has an
--     out-of-enum value, the new CHECK will fail loud (rather than
--     silently accept the new constraints).

BEGIN;

-- ══════════════════════════════════════════════════════════════════════
-- 1. admin_users.phone — login by phone (in addition to email).
-- ══════════════════════════════════════════════════════════════════════
ALTER TABLE admin_users
  ADD COLUMN IF NOT EXISTS phone VARCHAR(20);

-- Backfill admin users that already had an email but no phone — copy
-- from `users.phone` whenever a row matches by normalized email. If no
-- customer row exists, leave the admin's phone NULL (operators can
-- backfill manually via the admin UI).
UPDATE admin_users au
   SET phone = u.phone
  FROM users u
 WHERE au.phone IS NULL
   AND au.email IS NOT NULL
   AND LOWER(au.email) = LOWER(u.email);

-- Case-insensitive unique index. Lower() is fine because the column
-- is small and login queries will go through this same predicate.
CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_users_phone_ci
  ON admin_users (LOWER(phone))
  WHERE phone IS NOT NULL;

-- ══════════════════════════════════════════════════════════════════════
-- 2. vendor_staff.phone — owner / manager / staff login by phone.
-- ══════════════════════════════════════════════════════════════════════
ALTER TABLE vendor_staff
  ADD COLUMN IF NOT EXISTS phone VARCHAR(20);

-- Unique per vendor so two stores can each have a "05xxxxxxxx" owner.
CREATE UNIQUE INDEX IF NOT EXISTS idx_vendor_staff_vendor_phone_ci
  ON vendor_staff (vendor_id, LOWER(phone))
  WHERE phone IS NOT NULL;

-- ══════════════════════════════════════════════════════════════════════
-- 3. Expand vendors.vendor_type — broader merchant categories.
-- ══════════════════════════════════════════════════════════════════════
ALTER TABLE vendors DROP CONSTRAINT IF EXISTS vendors_vendor_type_check;

-- Recreate the CHECK with the expanded enum. We keep all 5 legacy
-- keys for backwards compatibility (any existing row keeps working)
-- and add the 8 new categories requested by the dashboard team.
ALTER TABLE vendors
  ADD CONSTRAINT vendors_vendor_type_check CHECK (vendor_type IN (
    -- legacy / existing categories
    'food_beverage', 'fashion', 'gifts', 'electronics', 'services',
    -- new categories (Arabic label mapping lives in src/lib/vendors.ts)
    'grocery_supermarket', -- بقالة / سوبرماركت
    'restaurant_cafe',     -- مطاعم وكافيهات
    'sweets_bakery',       -- حلويات ومعجنات
    'pharmacy_health',     -- صيدلية ومستلزمات صحية
    'beauty_cosmetics',    -- تجميل وعطور
    'flowers_plants',      -- ورد ونباتات
    'books_stationery',    -- كتب وقرطاسية
    'sports_fitness'       -- رياضة ولياقة
  ));

COMMIT;

-- ══════════════════════════════════════════════════════════════════════
-- POST-MIGRATION VERIFICATION (run separately after COMMIT):
-- ══════════════════════════════════════════════════════════════════════
-- SELECT slug, vendor_type FROM vendors WHERE vendor_type NOT IN (
--   'food_beverage','fashion','gifts','electronics','services',
--   'grocery_supermarket','restaurant_cafe','sweets_bakery','pharmacy_health',
--   'beauty_cosmetics','flowers_plants','books_stationery','sports_fitness'
-- );   -- expected: 0 rows
--
-- SELECT COUNT(*) FROM admin_users WHERE phone IS NULL;
--   -- operator backfill list — set phones via the admin UI to enable
--   -- phone-OTP login for each account.
