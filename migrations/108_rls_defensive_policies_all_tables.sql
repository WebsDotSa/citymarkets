-- migration 108: defensive RLS policies for all RLS-enabled tables
--
-- Migration 105 set `citymarket_user` to `BYPASSRLS=t` so the application
-- could read/write every table. Migration 099 (DROP DEAD RLS POLICIES)
-- left 34 tables with `rowsecurity=true` but **no policies** — they
-- relied entirely on the BYPASSRLS attribute.
--
-- Migration 107 added a defensive policy on `users` only.
-- This migration extends that pattern to every remaining table that
-- has RLS enabled, so the app keeps working if anyone ever runs
-- `ALTER ROLE citymarket_user WITH NOBYPASSRLS` by accident during a
-- future GRANT cleanup.
--
-- For each table we create one ALL policy scoped to `citymarket_user`
-- with `USING (true)` and `WITH CHECK (true)`. This mirrors the access
-- shape the BYPASSRLS attribute provides today.
--
-- Reference: src/lib/identity/admin-api-auth-db.ts and the access
-- patterns across src/app/api/**/route.ts — every API route connects
-- as `citymarket_user` (DATABASE_USER=citymarket_user) so a single
-- policy per table covers all read + write + delete paths.
--
-- Run order: AFTER migration 107. BEFORE any future GRANT cleanup that
-- touches BYPASSRLS on citymarket_user.

BEGIN;

DO $$
DECLARE
  tbl TEXT;
  policy_name TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'addresses',
    'admin_audit_logs',
    'admin_users',
    'ai_sessions',
    'analytics_events',
    'banners_legacy_077',
    'blog_posts',
    'cart',
    'coupons',
    'delivery_settings',
    'drivers',
    'guest_cart',
    'job_applications',
    'loyalty_points',
    'loyalty_transactions',
    'native_push_tokens',
    'offer_targets',
    'offers',
    'order_items',
    'orders',
    'page_views',
    'product_reviews',
    'push_subscriptions',
    'spin_results',
    'stores',
    'user_otps',
    'vendor_applications',
    'vendor_coupons',
    'vendor_daily_stats',
    'vendor_order_items',
    'vendor_orders',
    'vendor_products',
    'vendor_settings',
    'vendor_staff'
  ]
  LOOP
    policy_name := tbl || '_app_all';
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = tbl
        AND policyname = policy_name
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR ALL TO citymarket_user USING (true) WITH CHECK (true)',
        policy_name, tbl
      );
    END IF;
  END LOOP;
END
$$;

COMMIT;
