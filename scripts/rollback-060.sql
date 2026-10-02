-- 060a_rollback.sql (renamed from 060_rollback.sql in PCP-115)
-- Reverse migration 060b_vendors_cleanup_and_split.sql (renamed from
-- 060_vendors_cleanup_and_split.sql in PCP-115). The 060 prefix
-- collided with 060_drop_delivery_zones, and 060b collided with the
-- new 059b/c split — see migrations/110_pcp115_rename_duplicate
-- prefixes for the full audit.
-- Restores: aamiz-kafeh → qahwa-amaze, aamiz-lilwarood deleted,
-- abaya-store + gifts recreated EMPTY, products back under city-markets,
-- root categories reactivated.

BEGIN;

-- 1. Move the transferred vendor_products back to city-markets
UPDATE vendor_products vp
   SET vendor_id = (SELECT id FROM vendors WHERE slug = 'city-markets'),
       updated_at = NOW()
 WHERE vp.vendor_id IN (
   SELECT id FROM vendors WHERE slug IN ('aamiz-kafeh', 'aamiz-lilwarood')
 );

-- 2. Rename vendor back
UPDATE vendors
   SET slug = 'qahwa-amaze',
       name_ar = 'قهوة Amaze',
       name_en = 'Amaze Coffee',
       description_ar = 'أفضل قهوة في الرياض مع أجواء مميزة'
 WHERE slug = 'aamiz-kafeh';

-- 3. Delete aamiz-lilwarood
DELETE FROM vendors WHERE slug = 'aamiz-lilwarood';

-- 4. Recreate empty abaya-store + gifts
INSERT INTO vendors (slug, name_ar, name_en, vendor_type, category_slug, is_featured, sort_order, description_ar, primary_color)
VALUES
  ('abaya-store', 'عبايات', 'Abayas', 'fashion', 'fashion', TRUE, 2, 'عبايات فاخرة بأحدث التصاميم', '#9C27B0'),
  ('gifts', 'هدايا', 'Gifts', 'gifts', 'gifts', TRUE, 3, 'أجمل الهدايا للمناسبات المختلفة', '#E91E63')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO vendor_settings (vendor_id, delivery_mode, min_order_amount, accepts_cod, accepts_online_payment)
SELECT id, 'shared', 0, TRUE, TRUE FROM vendors WHERE slug IN ('abaya-store','gifts')
ON CONFLICT (vendor_id) DO NOTHING;

-- 5. Reactivate root categories
UPDATE categories SET is_active = TRUE
 WHERE slug IN ('amyz-kafyh', 'warwad-amyz');

COMMIT;
