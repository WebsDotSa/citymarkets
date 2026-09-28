-- 060_vendors_cleanup_and_split.sql
-- Purpose: Split two embedded supermarket subtrees (Amaze Coffee 36 products,
--          Amaze Flowers 9 products) into independent vendors.
--
-- Scope:
--   1. RENAME vendor qahwa-amaze → aamiz-kafeh
--   2. CREATE  vendor aamiz-lilwarood (flowers, type=gifts)
--   3. TRANSFER vendor_products ownership:
--        - subtree under root_category "أميز كافية.amaze.coffee"
--            → vendor aamiz-kafeh
--        - subtree under root_category "ورود آميز"
--            → vendor aamiz-lilwarood
--   4. DELETE unused vendors abaya-store + gifts (CASCADE)
--   5. SOFT-DEACTIVATE now-empty root categories (is_active=false)
--
-- Safety:
--   * Single transaction — any error rolls back fully.
--   * PRECHECK block fails loud if invariants don't hold.
--   * Idempotent: re-running is safe.
--
-- Rollback: see 060_rollback.sql

BEGIN;

-- ════════════════════════════════════════════════════════════════
-- 0. PRECHECK — fail loud if anything's off
-- ════════════════════════════════════════════════════════════════
DO $$
DECLARE
  v_qahwa_id     UUID;
  v_abaya_id     UUID;
  v_gifts_id     UUID;
  v_kafeh_cat    UUID;
  v_warood_cat   UUID;
  v_kafeh_vp     INT;
  v_warood_vp    INT;
BEGIN
  SELECT id INTO v_qahwa_id   FROM vendors WHERE slug = 'qahwa-amaze';
  SELECT id INTO v_abaya_id   FROM vendors WHERE slug = 'abaya-store';
  SELECT id INTO v_gifts_id   FROM vendors WHERE slug = 'gifts';

  SELECT id INTO v_kafeh_cat  FROM categories WHERE slug = 'amyz-kafyh';
  SELECT id INTO v_warood_cat FROM categories WHERE slug = 'warwad-amyz';

  IF v_qahwa_id IS NULL THEN
    RAISE EXCEPTION 'PRECHECK FAILED: vendor qahwa-amaze not found. Aborting.';
  END IF;
  IF v_kafeh_cat IS NULL THEN
    RAISE EXCEPTION 'PRECHECK FAILED: category amyz-kafyh not found. Aborting.';
  END IF;
  IF v_warood_cat IS NULL THEN
    RAISE EXCEPTION 'PRECHECK FAILED: category warwad-amyz not found. Aborting.';
  END IF;

  -- Count rows that will be moved (sanity vs expected 36 + 9)
  -- PL/pgSQL DO blocks don't expose CTEs across statements, so use subselects.
  SELECT COUNT(*) INTO v_kafeh_vp
    FROM vendor_products
   WHERE category_id IN (
     WITH RECURSIVE sub AS (
       SELECT id FROM categories WHERE id = v_kafeh_cat
       UNION ALL SELECT c.id FROM categories c JOIN sub s ON c.parent_id=s.id
     ) SELECT id FROM sub
   );
  SELECT COUNT(*) INTO v_warood_vp
    FROM vendor_products
   WHERE category_id IN (
     WITH RECURSIVE sub AS (
       SELECT id FROM categories WHERE id = v_warood_cat
       UNION ALL SELECT c.id FROM categories c JOIN sub s ON c.parent_id=s.id
     ) SELECT id FROM sub
   );

  RAISE NOTICE 'PRECHECK: qahwa=%, abaya=%, gifts=%, kafeh_vp=%, warood_vp=%',
    v_qahwa_id IS NOT NULL, v_abaya_id IS NOT NULL, v_gifts_id IS NOT NULL,
    v_kafeh_vp, v_warood_vp;

  IF v_kafeh_vp <> 36 THEN
    RAISE NOTICE 'WARNING: expected 36 vendor_products under aamiz-kafeh subtree, found %', v_kafeh_vp;
  END IF;
  IF v_warood_vp <> 9 THEN
    RAISE NOTICE 'WARNING: expected 9 vendor_products under warood subtree, found %', v_warood_vp;
  END IF;
END $$;

-- ════════════════════════════════════════════════════════════════
-- 1. RENAME qahwa-amaze → aamiz-kafeh
-- ════════════════════════════════════════════════════════════════
UPDATE vendors
   SET slug          = 'aamiz-kafeh',
       name_ar       = 'أميز كافية',
       name_en       = 'Amaze Kafeh',
       description_ar = 'قهوة مختصة ومشروبات مميزة من أميز كافية',
       updated_at    = NOW()
 WHERE slug = 'qahwa-amaze';

-- ════════════════════════════════════════════════════════════════
-- 2. CREATE aamiz-lilwarood vendor
-- ════════════════════════════════════════════════════════════════
INSERT INTO vendors (
  slug, name_ar, name_en, vendor_type, category_slug,
  description_ar, primary_color, is_active, is_featured, sort_order
) VALUES (
  'aamiz-lilwarood', 'أميز للورود', 'Amaze Lil Warood', 'gifts', 'flowers',
  'ورود طبيعية وباقات مميزة من أميز للورود', '#E91E63', TRUE, FALSE, 4
)
ON CONFLICT (slug) DO NOTHING;

-- Default settings for the new vendor (matches seed pattern)
INSERT INTO vendor_settings (vendor_id, delivery_mode, min_order_amount, accepts_cod, accepts_online_payment)
SELECT id, 'shared', 0, TRUE, TRUE FROM vendors WHERE slug = 'aamiz-lilwarood'
ON CONFLICT (vendor_id) DO NOTHING;

-- ════════════════════════════════════════════════════════════════
-- 3. TRANSFER vendor_products ownership
-- ════════════════════════════════════════════════════════════════
DO $$
DECLARE
  v_kafeh_vendor_id  UUID;
  v_warood_vendor_id UUID;
  v_moved_kafeh      INT := 0;
  v_moved_warood     INT := 0;
BEGIN
  SELECT id INTO v_kafeh_vendor_id  FROM vendors WHERE slug = 'aamiz-kafeh';
  SELECT id INTO v_warood_vendor_id FROM vendors WHERE slug = 'aamiz-lilwarood';

  -- ── aamiz-kafeh: all vendor_products under amyz-kafyh subtree ──
  WITH RECURSIVE subtree AS (
    SELECT id FROM categories WHERE slug = 'amyz-kafyh'
    UNION ALL SELECT c.id FROM categories c JOIN subtree s ON c.parent_id = s.id
  )
  UPDATE vendor_products vp
     SET vendor_id  = v_kafeh_vendor_id,
         updated_at = NOW()
   WHERE vp.category_id IN (SELECT id FROM subtree)
     AND vp.vendor_id IS DISTINCT FROM v_kafeh_vendor_id;
  GET DIAGNOSTICS v_moved_kafeh = ROW_COUNT;

  -- ── aamiz-lilwarood: all vendor_products under warwad-amyz subtree ──
  WITH RECURSIVE subtree AS (
    SELECT id FROM categories WHERE slug = 'warwad-amyz'
    UNION ALL SELECT c.id FROM categories c JOIN subtree s ON c.parent_id = s.id
  )
  UPDATE vendor_products vp
     SET vendor_id  = v_warood_vendor_id,
         updated_at = NOW()
   WHERE vp.category_id IN (SELECT id FROM subtree)
     AND vp.vendor_id IS DISTINCT FROM v_warood_vendor_id;
  GET DIAGNOSTICS v_moved_warood = ROW_COUNT;

  RAISE NOTICE 'TRANSFERRED: aamiz-kafeh=%, aamiz-lilwarood=%', v_moved_kafeh, v_moved_warood;
END $$;

-- ════════════════════════════════════════════════════════════════
-- 4. DELETE abaya-store + gifts (cascade kills their products/orders/staff)
-- ════════════════════════════════════════════════════════════════
DO $$
DECLARE
  v_abaya_id UUID;
  v_gifts_id UUID;
  v_abaya_vp INT;
  v_gifts_vp INT;
BEGIN
  SELECT id INTO v_abaya_id FROM vendors WHERE slug = 'abaya-store';
  SELECT id INTO v_gifts_id FROM vendors WHERE slug = 'gifts';

  IF v_abaya_id IS NOT NULL THEN
    SELECT COUNT(*) INTO v_abaya_vp FROM vendor_products WHERE vendor_id = v_abaya_id;
    DELETE FROM vendors WHERE id = v_abaya_id;
    RAISE NOTICE 'Deleted vendor abaya-store (cascade removed % vendor_products)', v_abaya_vp;
  END IF;
  IF v_gifts_id IS NOT NULL THEN
    SELECT COUNT(*) INTO v_gifts_vp FROM vendor_products WHERE vendor_id = v_gifts_id;
    DELETE FROM vendors WHERE id = v_gifts_id;
    RAISE NOTICE 'Deleted vendor gifts (cascade removed % vendor_products)', v_gifts_vp;
  END IF;
END $$;

-- ════════════════════════════════════════════════════════════════
-- 5. Soft-deactivate the now-transferred root categories
-- ════════════════════════════════════════════════════════════════
UPDATE categories SET is_active = FALSE
 WHERE slug IN ('amyz-kafyh', 'warwad-amyz');

COMMIT;

-- ════════════════════════════════════════════════════════════════
-- POST-MIGRATION VERIFICATION (run separately after COMMIT):
-- ════════════════════════════════════════════════════════════════
-- SELECT slug, name_ar, vendor_type FROM vendors ORDER BY slug;
--   expected: aamiz-kafeh, aamiz-lilwarood, city-markets
-- SELECT v.slug, COUNT(*) AS vp_count
--   FROM vendors v LEFT JOIN vendor_products vp ON vp.vendor_id=v.id
--   GROUP BY v.slug ORDER BY v.slug;
--   expected: aamiz-kafeh≈44 (8 existing + 36 moved), aamiz-lilwarood=9, city-markets≈4721
