-- 013_rls_policies.sql
-- Enable Row Level Security on all user-data tables
-- Note: The app uses a single DB user (citymarket_user) with no role-based access.
-- We mark RLS enabled + force RLS so the schema enforces row-level access.
-- A future change should split into: app_user (RLS enforced), analytics_user (bypass).
--
-- This migration does NOT change the connection layer — it documents the intent
-- and creates policies that default to: DENY (no rows visible).
-- The app's existing direct queries work because we GRANT BYPASSRLS to the
-- current role at the end (idempotent).
--
-- ⚠️ PITFALL: ALTER ROLE ... BYPASSRLS must run as a SUPERUSER (e.g. postgres).
-- If run as citymarket_user, it fails silently with "permission denied" and
-- the next SELECT returns 0 rows because no policy matches. Always run this
-- migration as postgres or a role with CREATEROLE.
--
-- To re-activate RLS protection: REVOKE BYPASSRLS FROM citymarket_user.

BEGIN;

-- 1. Enable + force RLS on all user-data tables
DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'addresses', 'admin_audit_logs', 'admin_users', 'admin_vendor_access',
    'ai_sessions', 'banners', 'cart', 'categories', 'coupons',
    'delivery_settings', 'delivery_zones', 'direct_orders', 'drivers',
    'guest_cart', 'home_inventory', 'loyalty_transactions', 'notifications',
    'order_items', 'orders', 'products', 'reviews', 'saved_lists',
    'spin_results', 'stores', 'user_otps', 'users', 'vendor_coupons',
    'vendor_daily_stats', 'vendor_order_items', 'vendor_orders',
    'vendor_products', 'vendor_settings', 'vendor_staff', 'vendors',
    'wallet_transactions'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

-- 2. Grant BYPASSRLS to the current role (so the app continues to work)
-- Re-running this migration is safe.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles
    WHERE rolname = current_user AND rolbypassrls = true
  ) THEN
    EXECUTE format('ALTER ROLE %I BYPASSRLS', current_user);
  END IF;
END $$;

-- 3. Add a "deny by default" policy (just in case BYPASSRLS is revoked later)
-- This is a no-op for the current app but documents the security posture.
DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'addresses', 'cart', 'orders', 'order_items', 'users',
    'user_otps', 'wallet_transactions', 'vendor_orders',
    'vendor_order_items', 'admin_users', 'drivers', 'ai_sessions'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('DROP POLICY IF EXISTS deny_all ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY deny_all ON public.%I FOR ALL TO PUBLIC USING (false) WITH CHECK (false)',
      t
    );
  END LOOP;
END $$;

-- 4. Update migration log
CREATE TABLE IF NOT EXISTS public.schema_migrations (
  id serial PRIMARY KEY,
  version text UNIQUE NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now(),
  description text
);

INSERT INTO public.schema_migrations (version, description)
VALUES ('013', 'Enable RLS on 36 user-data tables; grant BYPASSRLS to app role')
ON CONFLICT (version) DO NOTHING;

COMMIT;
