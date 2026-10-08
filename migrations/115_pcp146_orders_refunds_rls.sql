-- 115 — PCP-146 — Enable RLS on orders_refunds + add defensive policy.
--
-- Background (Phase 15 spike 006 — rls-policy-gaps):
--   orders_refunds is a 64 kB table that holds refund-ledger records
--   (one row per gateway refund attempt). It has FKs to users and
--   payment_events. Phase 14 migration 108 added defensive RLS
--   policies across 34 other tables, but **omitted orders_refunds**
--   because at the time it had rowsecurity=off.
--
-- Why this matters:
--   * orders_refunds is the ONLY non-postgres-owned table in public
--     that holds customer-financial data — owner is citymarket_user,
--     so RLS would actually apply (unlike postgres-owned tables).
--   * Migration 105 granted citymarket_user BYPASSRLS, so the app
--     keeps working regardless. But if anyone ever strips BYPASSRLS
--     during a future GRANT cleanup, this table would silently start
--     returning 0 rows (or rejecting all writes) — same class of
--     outage as the Phase 14 incident.
--   * Adding RLS + a permissive policy now pre-empts that failure
--     mode with zero functional cost.
--
-- Safety:
--   * RLS enabled, NOT forced (matches Phase 14 convention from
--     migration 097 which removed FORCE from all tables).
--   * Policy: FOR ALL TO citymarket_user USING (true) WITH CHECK (true)
--     — mirrors migration 108's pattern. App connects as citymarket_user
--     for every read/write to this table (no SQL in src/ touches
--     orders_refunds today; it is written only by the payment-reconcile
--     worker and read only by admin refund routes, all running under
--     citymarket_user).
--   * IF NOT EXISTS guards make the migration idempotent.
--   * Owner remains citymarket_user (matches current ownership — do not
--     touch, it's load-bearing for grants/sequences).
--
-- Reference:
--   spikes/006-rls-policy-gaps/README.md
--   migrations/108_rls_defensive_policies_all_tables.sql
--   migrations/105_grants_rls_and_bypass_for_citymarket_user.sql

BEGIN;

-- 1. Enable RLS (no FORCE — matches migration 097/108 convention).
ALTER TABLE public.orders_refunds ENABLE ROW LEVEL SECURITY;

-- 2. Defensive policy identical to migration 108's pattern.
--    Idempotent: skip if the policy already exists (e.g. operator
--    added it manually before this migration landed).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'orders_refunds'
      AND policyname = 'orders_refunds_app_all'
  ) THEN
    CREATE POLICY orders_refunds_app_all
      ON public.orders_refunds
      FOR ALL
      TO citymarket_user
      USING (true)
      WITH CHECK (true);
  END IF;
END
$$;

-- Audit marker (Phase 14/15 convention from migrations 111/112/113/114).
INSERT INTO _migration_guards (guard_name, active, created_at)
  VALUES ('pcp146_orders_refunds_rls', TRUE, NOW())
  ON CONFLICT (guard_name) DO UPDATE
    SET active = EXCLUDED.active,
        created_at = EXCLUDED.created_at;

COMMIT;