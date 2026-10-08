-- ══════════════════════════════════════════════════════════════
-- 097 — Remove FORCE ROW LEVEL SECURITY from all tables (P0 fix)
--
-- After migration 096 removed NOSUPERUSER NOBYPASSRLS from
-- citymarket_user, all tables with relforcerowsecurity=true became
-- unreadable even by the table owner (citymarket_user) due to the
-- 'deny_all' policy being active for all roles.
--
-- This migration:
--   1. Disables FORCE ROW LEVEL SECURITY on all 31 affected tables
--      (RLS itself remains enabled but is bypassed for the table owner)
--   2. Tables keep their RLS policies intact (documentation only)
--   3. Application code can now read/write normally via citymarket_user
--
-- Why: When FORCE RLS is enabled, even the table owner is subject to
-- policies. With citymarket_user as a NOSUPERUSER NOBYPASSRLS role,
-- the 'deny_all' policies blocked all access. Disabling FORCE keeps
-- RLS available for documentation purposes but allows the table owner
-- to bypass policies when needed.
--
-- Forward-only.
-- ══════════════════════════════════════════════════════════════

DO $$
DECLARE
  r RECORD;
  count INTEGER := 0;
BEGIN
  FOR r IN
    SELECT c.relname
    FROM pg_class c
    WHERE c.relkind = 'r'
      AND c.relnamespace = 'public'::regnamespace
      AND c.relforcerowsecurity = true
  LOOP
    EXECUTE format('ALTER TABLE public.%I NO FORCE ROW LEVEL SECURITY', r.relname);
    count := count + 1;
  END LOOP;
  RAISE NOTICE 'Removed FORCE RLS from % tables', count;
END $$;
