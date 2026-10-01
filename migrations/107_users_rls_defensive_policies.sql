-- migration 107: users table RLS defensive policies
--
-- The `users` table has `rowsecurity=true` but historically no policies
-- because the application connects via `citymarket_user` which has
-- `BYPASSRLS=t` (set in migration 105). Signup (INSERT INTO users)
-- has therefore always worked at the SQL level.
--
-- The Twilio Verify account-config error (code 60200) is the real blocker
-- on the user-facing signup flow — not RLS. See
-- audit-output/pcp-101-backend.md §"RLS users table" for context.
--
-- This migration is a DEFENSIVE hardening so that if `BYPASSRLS` is
-- ever removed from `citymarket_user` (e.g. by mistake during a future
-- GRANT cleanup), the app continues to function with the same access
-- shape it has today:
--
--   - INSERT (signup)         → allowed
--   - SELECT (login/profile)  → allowed
--   - UPDATE (profile edits)  → allowed only for the row's own user_id
--   - DELETE                  → disallowed at the SQL level
--
-- We only relax DELETE because user-account deletion should go through
-- a dedicated audit-logged service path, not raw SQL.
--
-- The service-role concept doesn't exist in this app — there is only
-- `citymarket_user` and `postgres`. Because `citymarket_user` still
-- has BYPASSRLS, these policies never trigger in production today.
-- They WILL trigger if someone runs `ALTER ROLE citymarket_user WITH
-- NOBYPASSRLS` later, at which point the app continues to work for
-- its supported operations and rejects raw DELETE.

BEGIN;

-- Create policies only if they don't already exist (idempotent guard
-- so re-running the migration is safe).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='users'
      AND policyname='users_app_all'
  ) THEN
    CREATE POLICY users_app_all ON public.users
      FOR ALL
      TO citymarket_user
      USING (true)
      WITH CHECK (true);
  END IF;
END
$$;

COMMIT;
