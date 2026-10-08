-- ══════════════════════════════════════════════════════════════
-- 101 — Apply and register missing migrations
--
-- After the DB cluster rebuild (postgres/migration_user/citymarket_user
-- role separation, restore from dump), the trigger function and trigger
-- created by 091 were lost. 098, 099, 100 were never applied because
-- the migration runner tracked them in app_migrations before the
-- rebuild but the SQL never ran against the fresh DB.
--
-- This migration:
--   1. Re-applies the guard function and trigger from 091.
--   2. Drops 43 dead RLS policies (the 099 cleanup, never applied).
--   3. Sets the trigger to INSERT/UPDATE-only (100 — DELETE allowed
--      so admin can retire orphan products).
--   4. Registers itself in app_migrations so future runs don't replay it.
-- ══════════════════════════════════════════════════════════════

BEGIN;

-- 1. Re-apply guard function (idempotent)
CREATE OR REPLACE FUNCTION guard_products_readonly() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION
    'products is read-only since migration 091 (2026-09-30). '
    'All catalog writes must target vendor_products. '
    'If you reached this from a migration, use vendor_products instead. '
    'If you reached this from application code, that code path is a regression — '
    'open a ticket against src/lib/catalog/ before retrying.';
END;
$$ LANGUAGE plpgsql;

-- 2. Re-apply INSERT/UPDATE-only trigger (replaces any existing definition)
DROP TRIGGER IF EXISTS products_readonly_guard ON products;
CREATE TRIGGER products_readonly_guard
  BEFORE INSERT OR UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION guard_products_readonly();

-- 3. Drop dead RLS policies (099 logic — never applied after rebuild).
-- FORCE ROW LEVEL SECURITY was removed in 097; without it, the policies
-- never fire for the table owner (citymarket_user) so they are dead code.
DO $$
DECLARE
  r RECORD;
  count INTEGER := 0;
BEGIN
  FOR r IN
    SELECT c.relname AS tbl, p.polname AS pol
    FROM pg_policy p
    JOIN pg_class c ON p.polrelid = c.oid
    WHERE c.relkind = 'r'
      AND c.relnamespace = 'public'::regnamespace
      AND NOT c.relforcerowsecurity
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.pol, r.tbl);
    count := count + 1;
  END LOOP;
  RAISE NOTICE 'Dropped % dead policies', count;
END $$;

COMMIT;

-- Record in app_migrations so the migration runner skips on next runs
-- (filename is the PK; ON CONFLICT DO NOTHING suppresses the unique-violation)
INSERT INTO app_migrations (filename, checksum)
VALUES ('101_apply_missing_after_rebuild.sql', 'manual:101')
ON CONFLICT (filename) DO NOTHING;
