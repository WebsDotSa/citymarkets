-- 064_normalize_admin_phones_to_e164.sql
-- Purpose:
--   Normalize `admin_users.phone` from local Saudi format (05XXXXXXXX)
--   to E.164 (+9665XXXXXXXX) so the OTP login lookup (which queries
--   by E.164) actually matches existing admin/driver rows that were
--   backfilled from `users.phone` in migration 063.
--
-- Why:
--   admin_users.phone was created in 063 and backfilled from
--   `users.phone`, which stored numbers in the local 05XXXXXXXX
--   shape. The /api/admin/auth/login OTP path queries with the
--   normalized E.164 (+9665XXXXXXXX) form via `phoneForDb()`. Until
--   the data is normalized, the OTP lookup returns zero rows for any
--   admin whose stored phone is still in the legacy local shape.
--
-- Idempotency:
--   Uses `LIKE '05%'` filter so already-normalized `+966%` values
--   are skipped. Safe to re-run.

BEGIN;

UPDATE admin_users
   SET phone = '+966' || substring(phone FROM 2)
 WHERE phone LIKE '05%'
   AND phone NOT LIKE '+%';

-- Optional (informational): log how many rows we touched for the next
-- migration's audit. Does not fail if it returns 0.
DO $$
DECLARE
  touched INTEGER;
BEGIN
  GET DIAGNOSTICS touched = ROW_COUNT;
  RAISE NOTICE '[064] Normalized % admin_users.phone row(s) to E.164', touched;
END $$;

COMMIT;
