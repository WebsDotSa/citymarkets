-- ══════════════════════════════════════════════════════════════
-- 096 — Remove superuser/BYPASSRLS from citymarket_user (P0 Security)
--
-- Audit (2026-09-30): citymarket_user was created with superuser
-- privileges. This means:
--   1. RLS policies on all tables were bypassed (rolbypassrls = t)
--   2. The app could DROP, ALTER, or TRUNCATE any table
--   3. A SQL injection vulnerability = total DB compromise
--
-- This migration:
--   1. Removes SUPERUSER and BYPASSRLS from citymarket_user
--   2. Keeps CREATE ROLE and CREATEDB for migrations
--   3. Verifies citymarket_user still owns all tables (owners retain
--      full permissions on their tables regardless of role attrs)
--   4. Grants schema usage + sequence access if missing
--
-- Application code already uses owner-level access via Postgres pool,
-- so removing superuser should not affect runtime behavior.
--
-- IF THE APP FAILS AFTER THIS:
--   - Verify RLS policies are not enforced on app connection path
--   - Check that citymarket_user owns the migrations table
--   - Grant missing permissions on specific tables/sequences
--
-- Forward-only.
-- ══════════════════════════════════════════════════════════════

BEGIN;

-- 1. Verify citymarket_user owns enough tables (should be 50+)
DO $$
DECLARE
  owned_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO owned_count
  FROM pg_tables
  WHERE tableowner = 'citymarket_user' AND schemaname = 'public';

  RAISE NOTICE 'citymarket_user owns % tables', owned_count;

  IF owned_count < 50 THEN
    RAISE EXCEPTION 'Refusing to demote citymarket_user: owns too few tables (%), expected 50+', owned_count;
  END IF;
END
$$;

-- 2. Remove superuser + bypassrls
--    citymarket_user keeps CREATEDB, CREATEROLE for migrations tooling
ALTER ROLE citymarket_user NOSUPERUSER NOBYPASSRLS;

-- 3. Verify role attrs after change
DO $$
DECLARE
  rol_super BOOLEAN;
  rol_bypass BOOLEAN;
BEGIN
  SELECT rolsuper, rolbypassrls INTO rol_super, rol_bypass
  FROM pg_roles WHERE rolname = 'citymarket_user';

  RAISE NOTICE 'After ALTER: rolsuper=%, rolbypassrls=%', rol_super, rol_bypass;

  IF rol_super OR rol_bypass THEN
    RAISE EXCEPTION 'Failed to remove superuser/bypassrls';
  END IF;
END
$$;

-- 4. Grant schema usage (defensive — usually already granted)
GRANT USAGE ON SCHEMA public TO citymarket_user;

-- 5. Ensure sequences are usable (some migrations may have created new ones)
GRANT SELECT, USAGE ON ALL SEQUENCES IN SCHEMA public TO citymarket_user;

COMMIT;
