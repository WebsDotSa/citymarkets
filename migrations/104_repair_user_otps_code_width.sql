-- Migration 104: repair user_otps.code width to support hashed OTPs.
--
-- Background (audit 2026-10-01):
--   - Migration 011 declared user_otps.code as VARCHAR(10).
--   - src/app/api/v1/auth/login/route.ts hashOTP() returns a 64-char
--     SHA-256 hex digest (line 35).
--   - The INSERT (line 163-168) passes the hash, not the raw 4-digit code.
--   - At some point during a fresh-schema rebuild the column was narrowed
--     to VARCHAR(6), so the INSERT throws
--     `value too long for type character varying(6)`.
--
-- Impact:
--   - Customer phone-login via /api/v1/auth/login still succeeds (Twilio
--     verifies the code independently), so users are not locked out.
--   - But the local DB row that stores the OTP hash is never written,
--     so any future code that reads user_otps.code for verification will
--     find it empty.
--   - The column also reverted from TIMESTAMPTZ to TIMESTAMP (TZ-less)
--     during the same rebuild — drift the migration runner cannot detect
--     because the file's CHECKSUM still matches.
--
-- Fix:
--   - Widen user_otps.code back to VARCHAR(64) (SHA-256 hex = 64 chars).
--   - Convert expires_at and created_at back to TIMESTAMPTZ.
--   - Both are idempotent (no data is changed because the existing rows
--     were never written due to the original overflow).
--
-- Why not VARCHAR(10) like the original migration said:
--   The original VARCHAR(10) was sized for plaintext 4-6 digit codes,
--   not for the SHA-256 hash that the route actually stores. Going to
--   VARCHAR(64) matches the real schema contract enforced by the code.

BEGIN;

-- Widthen the code column to fit SHA-256 hex digests.
ALTER TABLE user_otps ALTER COLUMN code TYPE VARCHAR(64);

-- Restore timezone-aware timestamps.
ALTER TABLE user_otps
  ALTER COLUMN expires_at TYPE TIMESTAMPTZ USING expires_at AT TIME ZONE 'UTC',
  ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC';

COMMIT;
