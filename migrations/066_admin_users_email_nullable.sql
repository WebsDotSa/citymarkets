-- 066_admin_users_email_nullable.sql
-- Purpose:
--   Allow `admin_users.email` to be NULL so operators can create staff
--   members that sign in via phone+OTP only (no email).
--
-- Background:
--   * The admin dashboard was reworked so phone is the REQUIRED field
--     and email is OPTIONAL (see `adminStaffCreateSchema` in
--     `src/lib/validation/admin.ts`).
--   * The API at `/api/admin/admin-users` POST writes
--       `NULLIF($2, '')` into `email` — empty string becomes NULL.
--   * The DB column was still `NOT NULL UNIQUE`, so the INSERT failed
--     with "null value in column \"email\" of relation \"admin_users\"
--     violates not-null constraint" the moment an operator tried to
--     save a phone-only staff member (most visible when adding a
--     delivery_driver / مندوب since the form pre-fills phone first
--     and skips email).
--   * Migration 063 added `phone` as nullable but did NOT touch the
--     `email` constraint — that was the gap.
--
-- Plan:
--   1. Drop the existing `UNIQUE (email)` constraint (it covers NULLs
--      per SQL semantics — i.e. NULLs would be considered distinct —
--      but Postgres UNIQUE constraints treat NULLs as distinct in
--      some PG versions and not others; safer to use a partial
--      unique index).
--   2. Drop `NOT NULL` on `email`.
--   3. Recreate the uniqueness as a PARTIAL unique index that only
--      covers non-null values. This keeps the historic "no two
--      active emails match" guarantee while letting many rows have
--      `email = NULL` (phone-only staff).
--
-- Idempotency: every ALTER uses IF EXISTS / constraint-name checks;
-- the partial index is created with IF NOT EXISTS.

BEGIN;

-- 1. Drop the old NOT NULL + UNIQUE(email) constraint.
ALTER TABLE admin_users
  ALTER COLUMN email DROP NOT NULL;

-- 2. Replace the implicit UNIQUE(email) constraint with a partial
--    unique index that ignores NULLs. Lower() preserves the
--    case-insensitive matching that the legacy constraint provided.
--    The constraint name is `admin_users_email_key` (PG default for
--    inline UNIQUE on a column); drop the CONSTRAINT, not the
--    index — dropping the index alone leaves a dangling constraint.
ALTER TABLE admin_users
  DROP CONSTRAINT IF EXISTS admin_users_email_key;

DROP INDEX IF EXISTS idx_admin_users_email;
DROP INDEX IF EXISTS admin_users_email_key;

CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_users_email_ci
  ON admin_users (LOWER(email))
  WHERE email IS NOT NULL;

DO $$
DECLARE
  null_email_count INTEGER;
  total_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO total_count FROM admin_users;
  SELECT COUNT(*) INTO null_email_count FROM admin_users WHERE email IS NULL;
  RAISE NOTICE '[066] admin_users.email is now nullable. % rows total, % with NULL email (expected: 0 before any new INSERT)',
    total_count, null_email_count;
END $$;

COMMIT;