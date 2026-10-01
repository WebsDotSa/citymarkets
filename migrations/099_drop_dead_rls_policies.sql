-- ══════════════════════════════════════════════════════════════
-- 099 — Drop dead RLS policies (P1 cleanup 2026-09-30)
--
-- After migration 097 removed FORCE ROW LEVEL SECURITY from all
-- tables, the policies that were paired with FORCE became dead code:
-- FORCE made them apply to *every* role including the table owner.
-- Without FORCE, only non-owner roles see the policies, and the app
-- connects as `citymarket_user` which owns all 54 tables. The
-- policies never fire for the running app.
--
-- 43 such policies across 30 tables. They were originally meant to
-- protect sensitive data from non-app callers, but the application
-- is the only Postgres client (single-tenant deployment), so the
-- policies never had a non-owner caller to gate.
--
-- This migration drops them as documentation cleanup. If we ever
-- add a non-owner DB role (read-replica viewer, BI analyst, etc.)
-- we will re-introduce appropriate policies via a fresh audit.
--
-- Forward-only.
-- ══════════════════════════════════════════════════════════════

BEGIN;

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
