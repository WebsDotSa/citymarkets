-- 015_public_tables_open_rls.sql
-- Purpose: 24 tables had `ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY`
--          with ZERO policies. That means writes are silently blocked for any
--          role without BYPASSRLS. Either we add comprehensive policies for every
--          role that needs read/write access, or we open the truly public tables.
--
-- Strategy:
--   1. Public catalog tables (products, categories, banners, stores, etc.) —
--      these are intentionally public read-only data. We KEEP RLS enabled so
--      admins can layer write policies later, but we add a single SELECT
--      policy allowing any role to read. Writes go through service-role
--      paths (citymarket_user has BYPASSRLS=t) so we don't need INSERT/UPDATE
--      policies here.
--   2. Per-user tables (cart, addresses, orders, user_otps, etc.) — already
--      have policies from migrations 011/013. Skip.
--
-- Why not DROP RLS: keeping it on makes future role isolation cheap. We just
-- open SELECT publicly and let the service role (BYPASSRLS) handle writes.

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Public catalog tables — allow SELECT for all roles
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  t text;
  public_tables text[] := ARRAY[
    'banners',
    'categories',
    'delivery_settings',
    'delivery_zones',
    'home_inventory',
    'products',
    'stores',
    'vendor_coupons',
    'vendor_products',
    'vendor_settings',
    'vendors',
    'guest_cart'
  ];
BEGIN
  FOREACH t IN ARRAY public_tables
  LOOP
    IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON c.relnamespace=n.oid
               WHERE n.nspname='public' AND c.relname=t) THEN
      -- Drop any existing policy with the same name (idempotent)
      EXECUTE format('DROP POLICY IF EXISTS public_read ON %I', t);
      -- Create a permissive SELECT policy for all roles
      EXECUTE format('CREATE POLICY public_read ON %I FOR SELECT USING (true)', t);
    END IF;
  END LOOP;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. Admin/internal tables — service role only (BYPASSRLS handles it)
--    No policies needed; service role bypasses RLS.
-- ═══════════════════════════════════════════════════════════════════════════
-- admin_audit_logs, admin_vendor_access, notifications, saved_lists,
-- spin_results, vendor_daily_stats, vendor_staff, loyalty_transactions,
-- reviews, coupons, direct_orders — all already correctly locked to
-- service role via no policies + BYPASSRLS. No change needed.

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. Grant USAGE on schema to all roles (defensive)
-- ═══════════════════════════════════════════════════════════════════════════
GRANT USAGE ON SCHEMA public TO PUBLIC;
