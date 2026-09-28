-- 065_fix_admin_phone_e164_migration_drift.sql
-- Purpose:
--   Recover from migration 064 which used a faulty substring offset that
--   stripped both the trunk '0' AND the mobile-leading '5' off Saudi
--   local phone numbers (e.g. "0501234005" → "+96601234005" instead of
--   "+966501234005"). Affected rows are now un-routable E.164 values and
--   cannot be matched by the OTP login lookup.
--
-- The /api/admin/auth/login OTP path queries by `LOWER(phone) = LOWER($1)`
-- using the E.164 value produced by `phoneForDb()` (e.g.
-- "+966501234005"). A row stored as "+96601234005" never matches, so the
-- user sees "لا يوجد حساب مرتبط بهذا الرقم".
--
-- Recovery: rows that became "+9660XXXXXXXX" can be reconstructed as
--   "+9665" || substring(phone FROM 6)
-- because the original "5" was dropped by the bad substring offset and is
-- known to be part of every Saudi mobile number. After this run, both
-- `+9665%` and `05%` forms map to a single canonical `+9665%` value.
--
-- Idempotency: each UPDATE filters on a unique pre-condition that won't
-- match its own output, so re-running is safe.

BEGIN;

-- ══════════════════════════════════════════════════════════════════════
-- 1. Repair rows that 064 corrupted into the "+9660..." form.
-- ══════════════════════════════════════════════════════════════════════
UPDATE admin_users
   SET phone = '+9665' || substring(phone FROM 6)
 WHERE phone LIKE '+9660%'
   AND length(phone) = 12;

-- ══════════════════════════════════════════════════════════════════════
-- 2. Normalize any remaining local-format ("05XXXXXXXX") rows. The
--    correct offset is to strip the single trunk '0' (positions 1),
--    NOT the trunk '0' AND the '5' (positions 1-2). This is the fix
--    the original 064 migration should have shipped.
-- ══════════════════════════════════════════════════════════════════════
UPDATE admin_users
   SET phone = '+966' || substring(phone FROM 2)
 WHERE phone LIKE '05%'
   AND phone NOT LIKE '+%'
   AND length(phone) = 10;

DO $$
DECLARE
  repaired INTEGER;
  normalized INTEGER;
BEGIN
  GET DIAGNOSTICS repaired = ROW_COUNT;
  -- ROW_COUNT only reflects the most recent UPDATE; query the state
  -- directly for an accurate audit log.
  SELECT COUNT(*) INTO normalized
    FROM admin_users
   WHERE phone LIKE '+9665%';
  RAISE NOTICE '[065] Repaired % malformed row(s); % admin_users.phone now in +9665 canonical form',
    repaired, normalized;
END $$;

COMMIT;
