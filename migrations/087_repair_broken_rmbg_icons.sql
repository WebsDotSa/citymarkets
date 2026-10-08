-- Auto-generated from migration 043 at 2026-10-08T16:17:35.299Z
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
    ('اخرى', '8656fb69fd85'),
    ('البرجر', 'c9b4b8388b3b'),
    ('البهارات', '75e606148869'),
    ('الخضروات-والفواكه', '61b7aea069c2'),
    ('القهوة', '4651894de01c'),
    ('جبنة-سائلة', 'da9968392d01'),
    ('حفائض-الاطفال', 'bd2ed0f3c21c'),
    ('خضروات', '75006bf5f969'),
    ('دجاج-مفروم', '33fb167fadf3'),
    ('رقائق-البطاطس', '6a4ca8bbd439'),
    ('زبادي-يوناني', 'ded4db7f7316'),
    ('صدور-الدجاج', '8f355403b1db'),
    ('صوصات-السلطة', 'f5a8f97b9296'),
    ('علك', 'af316a03aa0a'),
    ('عيدان-البطاطس', 'acb708376d8d'),
    ('قشطة', '309991fbce34'),
    ('كوكيز', '16e43165bb72'),
    ('لحم-مفروم', '999ee2e35df7'),
    ('مجمد-جاهز-للطهي', 'd143be49a378'),
    ('city-bakery', 'b231407ce8cc'),
    ('مستلزمات-الجسم', 'b43d3d401503'),
    ('مسحوق-غسيل-الملابس', '1cb67dec9673'),
    ('معمول', 'cada59f893d8'),
    ('منظفات-متعددة-الاستخدامات', 'a9f03b0641ce'),
    ('ورقيات', '094531a9d403'),
    ('العصائر', 'b05ff7d855dd'),
    ('اللحوم-والدواجن', '6af50d77e50d'),
    ('بطاطس-مجمدة', '83a98f895b7a'),
    ('بقوليات-معلبة', '163ba68d51e7'),
    ('جبن', '3f902ff38a76'),
    ('جبنة-مكعبات', '1ef8cf49ea39'),
    ('حلوى', '2787b5812f37'),
    ('خبز----صامولي', 'bc7e3beebff4'),
    ('chilled-chicken', 'e82f4b99c3b6'),
    ('زبادي-منكه', 'f460eb097cdf'),
    ('سائل-غسيل-الملابس', '79e223293fd8'),
    ('شاورما-الدجاج', '1c0bb562b7f3'),
    ('صوصات-حلى', 'a1b96f6d2243'),
    ('فحم', 'eaedbbeae55f'),
    ('فطائر', '6599c2fe65e9'),
    ('fresh-fruits', '887309bb1297'),
    ('مرتديلا-ونقانق', 'cdb238035771'),
    ('مستلزمات-الشعر', 'a74d0b44081c'),
    ('tissues', 'f90d47e4d28e'),
    ('هريس-أغذية-الأطفال', '5e67db04eb8e'),
    ('ارجل-الدجاج', 'e961c3c1b18f'),
    ('الالبان-والاجبان', '1fa23db27ba2'),
    ('biscuits', 'd0efcca84375'),
    ('تورتيلا', '5cadf5e2ec36'),
    ('جبن-مبشور', 'b54e28c92e51'),
    ('حليب-مجفف', '3743221eb917'),
    ('شاي-الأعشاب', 'aef4b3144396'),
    ('صابون-غسل-المواعين', '81dffabe859b'),
    ('صوصات-الطبخ', '5d17c66d2e39'),
    ('عناية-اليدين', '31f792152624'),
    ('فواكه-مجمدة', 'd9423510723f'),
    ('كاس-وعلب', '06a8abaab0b7'),
    ('لحوم-طازجة', '136a6d88d2e2'),
    ('معجنات-مجمدة', 'bf7c73fa9383'),
    ('أدوات-للمطبخ', '227a773ebe45'),
    ('الأطعمة-المجمدة', 'beab24f2b888'),
    ('الشاي-الأسود', '87b235e45ca0'),
    ('الشوكولاتة', '04ca0f5cc5ef'),
    ('توست', 'ebaf5a9e9bc6'),
    ('جبنة-شرائح', '7b7d5e353559'),
    ('حليب-منكه', '6c1f1c958dd3'),
    ('خضروات-مجمدة', '12183fcf1bc8'),
    ('زيت-الزيتون', '24271b277f3d'),
    ('فواكه-معلبة', '7afafeece552'),
    ('مزيل-العرق', 'e9625bef5660'),
    ('المخبوزات', 'abfd16086a7c'),
    ('المعكرونة', 'b3c531fcd1d5'),
    ('حليب-مبخر', 'c85a4d6844ea'),
    ('frozen-chicken', '917fe6756eb6'),
    ('شابورة', '6fe39dd965ea'),
    ('كيك', '0da2568ccff3'),
    ('مستلزمات-الوجه', '767b6e6313a0'),
    ('soft-drinks', 'df436bcedc7a'),
    ('منعم-الاقمشة', '9d7413bb1815'),
    ('المقاضي', '35ca358d826b'),
    ('بحريات-مجمد', 'b042014ef54b'),
    ('حلويات-العيد', '38d8315a943e'),
    ('حليب-الثلاجة', 'a01bf6c90d21'),
    ('شامبو-العباية', 'ddbfb524ab99'),
    ('عصير-مركز', 'c2828a2465d3'),
    ('معطرات-الجو', '8edc5d11d41d'),
    ('nuts', 'e3b16e89e91b'),
    ('السناكات-والحلويات', '4e47018e420d'),
    ('الشاي-الأخضر', '7b2aff8c4b3b'),
    ('تونة', '8e234e211a52'),
    ('سمبوسة', '4db7fff42d8f'),
    ('كريمة-طبخ', '6f68bd0b9159'),
    ('مبيد-حشرات', 'd868b972ac7b'),
    ('مستلزمات-الاسنان', '185af6102590'),
    ('المشروبات', 'ca2763891764'),
    ('حليب-مكثف', 'eda5f57e8e39'),
    ('خليط-كيك', 'b07371c3b841'),
    ('زيت-الطبخ', 'f72d0feeaee7'),
    ('عناية-الاطفال', 'cbc1e74cd031'),
    ('مشروبات-الشعير', '2831fc9c43cd'),
    ('الأرز', '42465267eb6a'),
    ('العناية-بالمنزل', 'a537194f4d62'),
    ('الفشار', 'a0b85d97234c'),
    ('زبادي', '9445dad71a99'),
    ('مزيل-الشعر', '0ed9e48f7e2f'),
    ('مشروبات-الطاقة', '5056cf26999d'),
    ('جيلاتين', '4df88487c869'),
    ('عصائر-بدون-سكر', '37061ed51ba1'),
    ('كريمة-خفق', '0659ca389344'),
    ('مستلزمات-المرأة', '1c9fd21b8f56'),
    ('مستلزمات-المنزل', 'ed44751036b3'),
    ('معجون-طماطم', '2f571206e9f0'),
    ('العناية-الشخصية', '1c402e31646e'),
    ('المايونيز-والخردل', 'f299fa1981fd'),
    ('لبنة', '8ec2901dad99'),
    ('مستلزمات-الحلاقة', 'e0dd7d2b8ce0'),
    ('مياه', '5ed92fa21554'),
    ('حليب-طويل-الاجل', '8b607efa908a'),
    ('زيتون-وورق-عنب', 'b702388e4663'),
    ('الشطة', 'c6d627db13c7'),
    ('زبدة', '5596f68e9c29'),
    ('حليب-الاطفال', '87c45a5547d6'),
    ('سكر-وملح', '222687dbdf4b'),
    ('السمن', '9bc737e5e179'),
    ('معلبات-اخرى', 'bdd13963abef'),
    ('eggs', '26479584549d'),
    ('معلبات-قابلة-للدهن', '80b90f81d31d'),
    ('حلاوة-طحينية', '9e33a25d1b0d'),
    ('كاتشب', 'c8a8521f519d'),
    ('كورن-فليكس', '35a9a522bdde'),
    ('العسل', '84681aeb5f63'),
    ('بودرة', 'e7707921dc9a'),
    ('نودلز', '6b9fb4299994'),
    ('ذرة', '637724fb9964'),
    ('فطر', '7e8094792014'),
    ('التمور', '623e049b6222'),
    ('المعلبات', '3c090154f182'),
    ('مواد-غذائية', '2817844fa7af')
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
