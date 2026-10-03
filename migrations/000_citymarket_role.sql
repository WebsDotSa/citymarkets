-- Migration 000: ensure citymarket_user role exists.
--
-- Background (PCP-109, audit 2026-10-01):
--   migrations/001_full_schema.sql grants `ALL ON ALL TABLES IN SCHEMA
--   public TO citymarket_user;`. In production that role is created by
--   migrations/105_grants_rls_and_bypass_for_citymarket_user.sql, which
--   itself assumes 001 succeeded on a fresh DB. In CI the fresh DB has
--   only the POSTGRES_USER (ci_user), so the GRANT in 001 aborts the
--   whole migration run with `role "citymarket_user" does not exist`,
--   and no migration after it ever applies. This left CI red on every
--   commit since 015f3e5.
--
--   This migration creates the role up front, before 001, so the chain
--   applies cleanly on a fresh CI DB. It is fully idempotent
--   (`DO $$ ... EXCEPTION WHEN duplicate_object`) so re-runs on a DB
--   that already has the role (production, staging, second-run CI
--   containers) are no-ops.
--
--   Ownership matters: the migration runner connects as DATABASE_USER
--   (POSTGRES_USER in CI), which is a superuser in CI and the
--   app-owner in production — both are authorized to CREATE ROLE.
--   The role is created NOLOGIN because the app authenticates as a
--   single shared user (DATABASE_USER) instead of a per-service role
--   pattern; mirroring 105's password is left to the deploy step
--   (scripts/sync-db-password.sh).

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'citymarket_user') THEN
    CREATE ROLE citymarket_user NOLOGIN;
  END IF;
END$$;