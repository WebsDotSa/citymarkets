-- ══════════════════════════════════════════════════════════════
-- 094 — Vendor RLS policies (P1 audit 2026-09-30)
--
-- Two vendor-owned tables had RLS `forced` but no real policy:
--
--   1. vendor_coupons   — policy = `public_read` (SELECT only).
--                          Vendor's own POST/PATCH/DELETE on its rows
--                          would be denied. vendor_coupons has been
--                          empty since the schema was added, masking
--                          the bug.
--   2. vendor_daily_stats — no policy at all (RLS forced = DENY ALL).
--                            App-side writes to this table have been
--                            silently failing.
--
-- The project's existing RLS pattern (see wishlist_items,
-- native_push_tokens, etc.) is "RLS enabled but force = false" — the
-- application connects as the table owner (or superuser) and bypasses
-- RLS. Force=true on these two was the inconsistency.
--
-- Fix: relax `force` to false and replace the deny-all / read-only
-- policies with permissive policies that the app's existing queries
-- can satisfy without a per-connection GUC.
--
-- Pre-flight (verified by audit):
--   - 0 rows in vendor_coupons, 0 rows in vendor_daily_stats.
--   - No production data loss.
--   - App connects as citymarket_user (table owner) — RLS bypassed
--     unless force = true.
--
-- Forward-only.
-- ══════════════════════════════════════════════════════════════

BEGIN;

-- ─── vendor_coupons ──────────────────────────────────────────────
ALTER TABLE vendor_coupons NO FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS public_read ON vendor_coupons;

-- Keep SELECT permissive. App already filters by vendor_id in the
-- query, so an un-filtered SELECT would expose all rows — but since
-- RLS is no longer forced, the application code is responsible for
-- scoping. This matches every other vendor-owned table in the project.
CREATE POLICY vendor_coupons_select ON vendor_coupons
  FOR SELECT USING (true);

CREATE POLICY vendor_coupons_insert ON vendor_coupons
  FOR INSERT WITH CHECK (true);

CREATE POLICY vendor_coupons_update ON vendor_coupons
  FOR UPDATE USING (true) WITH CHECK (true);

CREATE POLICY vendor_coupons_delete ON vendor_coupons
  FOR DELETE USING (true);

-- ─── vendor_daily_stats ─────────────────────────────────────────
ALTER TABLE vendor_daily_stats NO FORCE ROW LEVEL SECURITY;

CREATE POLICY vendor_daily_stats_all ON vendor_daily_stats
  FOR ALL USING (true) WITH CHECK (true);

COMMIT;
