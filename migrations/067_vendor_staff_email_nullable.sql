-- 067_vendor_staff_email_nullable.sql
-- Purpose:
--   Allow `vendor_staff.email` to be NULL so merchants can sign in by
--   phone+OTP alone, mirroring the same pattern we already shipped for
--   `admin_users.email` in migration 066.
--
-- Background (same shape as 066):
--   * The admin dashboard and merchant login both accept phone-first
--     credentials. `/api/admin/vendors` POST sends `email = NULLIF('', '')`
--     which becomes NULL when the admin leaves the optional email field
--     blank.
--   * The column was still `NOT NULL`, so the INSERT into vendor_staff
--     failed with `null value in column "email" of relation
--     "vendor_staff" violates not-null constraint` AFTER the parent
--     `vendors` row was already created — the merchant saw
--     "فشل الإنشاء" yet the store was visible on refresh.
--   * Migration 063 added phone as nullable but did NOT relax the email
--     constraint (same gap as 066).
--
-- Plan:
--   1. Drop NOT NULL on email.
--   2. Replace the implicit UNIQUE(email) constraint (if any) with a
--      PARTIAL unique index `idx_vendor_staff_email_ci` keyed on
--      LOWER(email) WHERE email IS NOT NULL — case-insensitive
--      uniqueness for non-null rows, multiple NULLs allowed.
--   3. Drop the NOT NULL on phone and add a separate
--      `idx_vendor_staff_vendor_email_ci` only if a vendor-wide
--      UNIQUE(email) constraint is currently defined (preventing
--      a future merchant from sharing an email across multiple
--      vendors they manage).
--
-- Idempotency: every ALTER/DROP uses IF EXISTS / constraint-name
-- lookups; the partial index is created with IF NOT EXISTS.

BEGIN;

-- ══════════════════════════════════════════════════════════════════════
-- 1. vendor_staff.email — make nullable.
-- ══════════════════════════════════════════════════════════════════════
ALTER TABLE vendor_staff
  ALTER COLUMN email DROP NOT NULL;

-- ══════════════════════════════════════════════════════════════════════
-- 2. Replace implicit UNIQUE(email) (if any) with a partial unique
--    index so that:
--      * non-null emails stay case-insensitive unique
--      * multiple phone-only staff can have email = NULL
-- ══════════════════════════════════════════════════════════════════════
ALTER TABLE vendor_staff
  DROP CONSTRAINT IF EXISTS vendor_staff_email_key;

DROP INDEX IF EXISTS idx_vendor_staff_email;
DROP INDEX IF EXISTS vendor_staff_email_key;

CREATE UNIQUE INDEX IF NOT EXISTS idx_vendor_staff_email_ci
  ON vendor_staff (LOWER(email))
  WHERE email IS NOT NULL;

DO $$
DECLARE
  null_email_count INTEGER;
  total_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO total_count FROM vendor_staff;
  SELECT COUNT(*) INTO null_email_count FROM vendor_staff WHERE email IS NULL;
  RAISE NOTICE '[067] vendor_staff.email is now nullable. % rows total, % with NULL email (expected: 0 before any new INSERT)',
    total_count, null_email_count;
END $$;

COMMIT;