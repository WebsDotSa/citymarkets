-- Migration 105: grants + RLS + BYPASSRLS for citymarket_user.
--
-- Background (audit 2026-10-01):
--   The citymarkets.sa production rebuild left the `citymarket_user`
--   role in an inconsistent state:
--     1. Its password was stale relative to DATABASE_PASSWORD in .env.
--     2. It had no GRANTs on any tables in `public` — every SELECT
--        returned an empty row set under RLS.
--     3. Tables created in migrations 077+ had `rowsecurity = true`
--        with NO policies attached, so even after grants were issued,
--        every read returned 0 rows.
--     4. `citymarket_user` did not have `BYPASSRLS`, so the admin and
--        worker paths could not write to RLS-protected tables.
--
-- This migration is idempotent — every statement uses `IF NOT EXISTS`
-- or guard checks so re-running it is safe.
--
-- After this migration:
--   - citymarket_user has GRANTs on all existing and future tables,
--     sequences, and the public schema.
--   - Public-read tables (categories, vendors, products, home_layouts)
--     have RLS disabled so they serve reads without per-row policies.
--   - citymarket_user has BYPASSRLS so admin paths can write anywhere.
--
-- Important: the password itself is NOT rotated here — that is handled
-- by the deploy step (sync .env DATABASE_PASSWORD into Postgres).
-- This migration only ensures the *role grants* and *table state* are
-- durable across container rebuilds.

-- ============================================================================
-- 1. Schema usage + default privileges for citymarket_user
-- ============================================================================

GRANT USAGE ON SCHEMA public TO citymarket_user;

-- Grants on all *existing* tables / sequences.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO citymarket_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO citymarket_user;

-- Default privileges for tables / sequences created in the future
-- (so new migrations don't accidentally bypass this fix).
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO citymarket_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO citymarket_user;

-- ============================================================================
-- 2. BYPASSRLS so admin / worker paths can write to RLS-protected tables
--    (orders, users, etc.) without per-row policies.
-- ============================================================================

-- Guarded because ALTER ROLE BYPASSRLS is not idempotent in all PG versions;
-- use DO block so re-running the migration is safe.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = 'citymarket_user' AND NOT rolbypassrls
  ) THEN
    ALTER USER citymarket_user BYPASSRLS;
  END IF;
END
$$;

-- ============================================================================
-- 3. Disable RLS on public-read tables.
--
-- These tables are served by /api/v1/categories, /api/v1/vendors,
-- /api/v1/products, /api/v1/home-layout — all public GET endpoints with
-- no row-level filtering. RLS without policies would silently hide every
-- row, so we disable it. Row-level access control for these tables is
-- enforced at the API layer (auth, vendor scoping, status filters).
-- ============================================================================

ALTER TABLE public.categories    DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendors       DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.products      DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.home_layouts  DISABLE ROW LEVEL SECURITY;

-- ============================================================================
-- 4. Audit log: ensure the changes are visible in migrations history.
-- ============================================================================

-- (app_migrations table already tracks this file via the standard runner.)
