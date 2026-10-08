-- ══════════════════════════════════════════════════════════════
-- 118_pcp201_disable_bypassrls.sql
-- PCP-201 (Phase 16 audit): the `citymarket_user` role had
-- `BYPASSRLS = true` (inherited from its original creation
-- before the defensive RLS migrations in Phase 14/15 — see
-- migration 105_grants_rls_and_bypass_for_citymarket_user.sql).
-- With BYPASSRLS, every RLS policy on every table was cosmetic
-- for the app role — a SQL-injection in any endpoint would
-- bypass the row-level security entirely. This is a
-- production-critical misconfiguration: the 36 RLS policies
-- shipped in migrations 105/108/115 were effectively dead
-- code for the role that the application actually connects as.
--
-- FIX: `ALTER ROLE citymarket_user NOBYPASSRLS;`. After this
-- statement commits, every SELECT/INSERT/UPDATE/DELETE the app
-- issues is subject to the table's RLS policies.
--
-- WHY THIS IS SAFE TO APPLY TODAY:
--   Every RLS policy on every table in this database is
--   `<table>_app_all` with the form
--       TO citymarket_user USING (true) WITH CHECK (true)
--   (see migration 105 + 108). A USING(true) policy passes
--   every row through. So turning RLS enforcement on for the
--   app role does NOT change which rows are visible or writable
--   to citymarket_user. The change is purely a posture fix:
--   the misconfiguration is removed so that FUTURE policies
--   (per-tenant, per-role) are actually enforced.
--
--   Direct verification: before this migration, run
--       SELECT count(*) FROM users;
--   as citymarket_user, the answer is the same before and
--   after. Same for INSERT/UPDATE/DELETE.
--
-- WHAT IS NOT SAFE (deferred to follow-up PRs):
--   * Per-tenant policies that restrict `users` SELECT to
--     `user_id = current_user_id()`. Until those are added, the
--     RLS posture is "enabled but permissive" — defense in depth
--     but not isolation.
--   * Removing the default `arwd` privileges and replacing with
--     column-level or row-level grants where appropriate.
--   * The 5 tables that have RLS disabled (categories,
--     contact_messages, payment_events, wishlist_items, vendors)
--     are still unprotected by RLS. Adding `ENABLE ROW LEVEL
--     SECURITY` to those is a separate decision (some of them
--     may be intentionally world-readable for the app).
--
-- Rollback: `ALTER ROLE citymarket_user BYPASSRLS;`
--   The migration is idempotent and safe to re-run.
-- ══════════════════════════════════════════════════════════════

ALTER ROLE citymarket_user NOBYPASSRLS;

-- Insert a guard record so the migration runner can detect if
-- someone accidentally re-grants BYPASSRLS later.
INSERT INTO _migration_guards (guard_name, active, created_at)
VALUES ('pcp201_citymarket_user_no_bypassrls', true, now())
ON CONFLICT (guard_name) DO UPDATE SET active = true, created_at = now();
