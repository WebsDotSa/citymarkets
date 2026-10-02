-- 060_rollback.sql
-- Reverse migration 060_vendors_cleanup_and_split.sql.
-- Restores: aamiz-kafeh → qahwa-amaze, aamiz-lilwarood deleted,
-- abaya-store + gifts recreated EMPTY, products back under city-markets,
-- root categories reactivated.
--
-- ⚠️  PCP-113 HARDENED (migration 109 added the _migration_guards table).
--
--   If _migration_guards.060_rollback_blocked is active, this file is
--   ABORTED at the top — the BEGIN/COMMIT below never executes. The
--   guard is set on every cluster where migration 109 has been applied
--   (which is the live production cluster as of 2026-10-02).
--
--   To force a real rollback (genuine disaster recovery, NOT a fresh
--   cluster rebuild), run this BEFORE applying 060_rollback.sql:
--     docker exec -e PGPASSWORD="$DB_PASSWORD" citymarket-db \
--       psql -U citymarket_user -d citymarket_db -c \
--       "DELETE FROM _migration_guards WHERE guard_name='060_rollback_blocked'"
--
--   Then run this file. Then re-apply migration 109 to re-arm the guard.
--
--   For routine fresh clusters, do NOT delete the guard. The numeric-order
--   migration runner will process 109 first (sets the guard), then
--   060_rollback.sql sees the guard and aborts.
--
-- The rollback below is preserved verbatim for emergency use but should
-- NOT run automatically. The fact that this file lives in the migrations/
-- directory at all is an audit red flag; the long-term fix is to move
-- rollbacks into a separate scripts/rollback/ directory and reference
-- them by manual operation only. Tracked as PCP-117.

-- Hard guard: the migration runner executes the entire file as ONE
-- client.query(). A RAISE EXCEPTION inside the DO block aborts the
-- surrounding transaction, so BEGIN/COMMIT below never executes. This
-- is the same pattern the migration runner relies on for atomic
-- migrations, and is the reason every earlier migration that does DDL
-- wraps its body in BEGIN/COMMIT.
--
-- The guard MUST be wrapped in the SAME transaction as the rollback
-- body. If we put the guard in a separate transaction, the runner
-- (which sees only "did this whole query succeed?") would record
-- success on the empty guard transaction and then run the body in a
-- second query that succeeds independently.
--
-- Therefore: the structure is
--     BEGIN
--       DO $$ … RAISE EXCEPTION … $$
--       UPDATE vendors … (rollback body)
--     COMMIT
--
-- If the guard trips, the EXCEPTION aborts the BEGIN block and
-- neither the UPDATE nor the COMMIT runs. The runner sees the
-- failed query and refuses to mark the migration as applied.

BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM _migration_guards
     WHERE guard_name = '060_rollback_blocked' AND active = true
  ) THEN
    RAISE EXCEPTION '060_rollback.sql: ABORTED — _migration_guards.060_rollback_blocked is active. To force a real rollback, DELETE FROM _migration_guards WHERE guard_name=''060_rollback_blocked'' first, then re-run this file, then re-apply migration 109 to re-arm the guard.';
  END IF;
END
$$;

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
