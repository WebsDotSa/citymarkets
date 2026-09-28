-- 042_category_taxonomy_reorder.sql
-- Purpose: repair category taxonomy that has accumulated drift since the
--          categories table grew past 100 rows (migrations 009, 039b, 040).
--
--          Re-parent categories that were filed under the wrong root,
--          disable seasonal items, clean typos, and apply a marketing
--          display order to the 11 root categories so the /categories
--          page renders them in a sensible shopper-first sequence.
--
-- Owner:  citymarket_user. Idempotent: re-running after a successful
--         apply is a no-op (every UPDATE / reparent step guards on
--         current state). Safe to ship to prod once dry-run output is
--         reviewed by a human.
--
-- Dry-run: scripts/dry-run-042.mjs prints the planned deltas without
--          touching the DB.

BEGIN;

-- =========================================================================
-- 1. REPARENTING PLAN
-- =========================================================================
-- The categories tree was built organically and accumulated drift. This
-- block moves each mis-filed subcategory under its semantically correct
-- parent. We build a temp plan that resolves each row to concrete
-- (source_parent_id, child_slug, target_parent_id) before the UPDATE.
-- That avoids slug-matching tricks in the join and makes the migration
-- fully idempotent: once a child is moved, the next run's join on
-- source_parent_id + child_slug finds zero matches and is a no-op.
-- =========================================================================

CREATE TEMP TABLE _reparent_plan (
  source_parent_id UUID NOT NULL,
  child_slug       TEXT NOT NULL,
  target_parent_id UUID
) ON COMMIT DROP;

INSERT INTO _reparent_plan (source_parent_id, child_slug, target_parent_id)
SELECT
  src.id,
  v.child_slug,
  tgt.id
FROM (VALUES
  -- (a) Pantry: canned goods lived under Home Supplies.
  ('مستلزمات-المنزل',  'المعلبات',                  'المقاضي'),
  -- (b) Snacks: popcorn under cake, potato sticks under candy.
  ('كيك',              'الفشار',                    'السناكات-والحلويات'),
  ('حلوى',             'عيدان-البطاطس',             'رقائق-البطاطس'),
  -- (c) Pantry: breakfast cereals (parent slug is English "biscuits").
  ('biscuits',         'كورن-فليكس',               'المقاضي'),
  -- (d) Pantry: olives/corn/mushroom (parent slug is English "fresh-fruits").
  ('fresh-fruits',     'زيتون-وورق-عنب',           'المقاضي'),
  ('fresh-fruits',     'ذرة',                      'المقاضي'),
  ('fresh-fruits',     'فطر',                      'المقاضي'),
  -- (e) Personal care: 7 personal-care subcats filed under home/hand roots.
  ('العناية-بالمنزل',  'مستلزمات-الجسم',            'العناية-الشخصية'),
  ('عناية-اليدين',     'مزيل-العرق',                'العناية-الشخصية'),
  ('عناية-اليدين',     'مستلزمات-الوجه',            'العناية-الشخصية'),
  ('عناية-اليدين',     'مستلزمات-المرأة',           'العناية-الشخصية'),
  ('عناية-اليدين',     'مزيل-الشعر',                'العناية-الشخصية'),
  ('مستلزمات-الشعر',   'شامبو-العباية',             'العناية-الشخصية'),
  ('مستلزمات-الحلاقة', 'مستلزمات-الاسنان',          'العناية-الشخصية'),
  -- (f) Frozen: produce that was filed under fresh roots.
  ('خضروات',           'خضروات-مجمدة',              'الأطعمة-المجمدة'),
  ('فواكه-مجمدة',      'فواكه-مجمدة',              'الأطعمة-المجمدة'),
  -- (g) Canned fruit: under fresh-fruits root.
  ('فواكه-معلبة',      'فواكه-معلبة',              'المعلبات'),
  -- (h) Home supplies: charcoal for barbecue.
  ('العناية-بالمنزل',  'فحم',                       'مستلزمات-المنزل'),
  -- (i) Pantry: canned subcats that were filed under home supplies.
  ('المعلبات',         'بقوليات-معلبة',             'المقاضي'),
  ('المعلبات',         'تونة',                      'المقاضي'),
  ('المعلبات',         'معلبات-اخرى',               'المقاضي'),
  ('المعلبات',         'معلبات-قابلة-للدهن',        'المقاضي'),
  ('كاس-وعلب',         'اخرى',                      'مستلزمات-المنزل')
) AS v(source_parent_slug, child_slug, target_parent_slug)
JOIN categories src ON src.slug = v.source_parent_slug AND src.is_active
LEFT JOIN categories tgt ON tgt.slug = v.target_parent_slug AND tgt.is_active;

UPDATE categories c
SET parent_id = p.target_parent_id
FROM _reparent_plan p
JOIN categories child
  ON child.slug = p.child_slug
 AND child.parent_id = p.source_parent_id
 AND child.is_active
WHERE c.id = child.id
  AND (p.target_parent_id IS NULL
       OR c.parent_id IS DISTINCT FROM p.target_parent_id);

DROP TABLE _reparent_plan;

-- =========================================================================
-- 2. SEASONAL / DUPLICATE HANDLING
-- =========================================================================
-- Ramadan 2026 has passed. Deactivate the seasonal subcategory so the
-- page doesn't show stale inventory. Re-activate for next Ramadan via
-- a new migration.
UPDATE categories
SET is_active = FALSE
WHERE slug IN ('مستلزمات-رمضانية')
  AND is_active IS DISTINCT FROM FALSE;

-- Fix the typo: "مواد غذاية" (broken) -> "مواد غذائية" (correct).
UPDATE categories
SET name_ar = 'مواد غذائية', slug = 'مواد-غذائية'
WHERE slug = 'مواد-غذاية';

-- =========================================================================
-- 3. ROOT-LEVEL MARKETING ORDER
-- =========================================================================
-- Display order: fresh first, then dairy/eggs, then frozen, then pantry
-- staples, then snacks & beverages, then non-food. The page also uses
-- this order as the sidebar tab order.
WITH order_plan(slug, sort_order) AS (
  VALUES
    ('الخضروات-والفواكه',      10),
    ('اللحوم-والدواجن',         20),
    ('الالبان-والاجبان',        30),
    ('الأطعمة-المجمدة',         40),
    ('المخبوزات',               50),
    ('المقاضي',                 60),
    ('السناكات-والحلويات',      70),
    ('المشروبات',               80),
    ('العناية-بالمنزل',         90),
    ('مستلزمات-المنزل',        100),
    ('العناية-الشخصية',        110)
)
UPDATE categories c
SET sort_order = op.sort_order
FROM order_plan op
WHERE c.slug = op.slug
  AND c.parent_id IS NULL
  AND c.sort_order IS DISTINCT FROM op.sort_order;

-- =========================================================================
-- 4. CHILD-LEVEL SORT ORDER = product count desc, name asc
-- =========================================================================
-- Within each root, order children by popularity so the most-shopped
-- categories land in the first viewport. Tiebreaker: Arabic name.
WITH ranked AS (
  SELECT
    c.id,
    ROW_NUMBER() OVER (
      PARTITION BY c.parent_id
      ORDER BY COALESCE(
        (SELECT COUNT(*) FROM products_unified p
         WHERE p.category_id = c.id AND p.is_active), 0
      ) DESC,
      c.name_ar ASC
    ) * 10 AS new_sort
  FROM categories c
  WHERE c.parent_id IS NOT NULL
    AND c.is_active
)
UPDATE categories c
SET sort_order = r.new_sort
FROM ranked r
WHERE c.id = r.id
  AND c.sort_order IS DISTINCT FROM r.new_sort;

-- =========================================================================
-- 5. INDEX HINT
-- =========================================================================
-- The page query already uses idx_categories_active. No new index needed.

COMMIT;

-- Post-apply verification (read-only — uncomment to run manually):
-- SELECT parent_id, COUNT(*) FROM categories WHERE is_active GROUP BY 1 ORDER BY 1;
