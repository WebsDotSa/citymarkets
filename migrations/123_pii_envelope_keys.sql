-- 123_pii_envelope_keys.sql
-- P0-PII-KMS (security Phase 5, 2026-10-03): envelope encryption.
-- See src/lib/security/pii-crypto.ts and docs/security/pii-encryption.md
-- for the new format and the operator runbook.
--
-- Scope
-- -----
-- Creates the `pii_keys` table that stores wrapped data encryption
-- keys (DEKs). Each row holds a single DEK wrapped by a master key
-- (KEK) using AES-256-KW (RFC 3394). The application unwraps the
-- DEK at boot by combining the wrapped form from this table with
-- the KEK from the PII_MASTER_KEY env var.
--
-- Why a table instead of just env
-- -------------------------------
-- 1. Rotation: a future Phase-6 (or later) KMS migration can add a
--    second row with key_version=2, encrypt new rows under it, and
--    decrypt old rows by looking up the matching version. The
--    ciphertext already carries the version byte (see
--    src/lib/security/pii-crypto.ts), so the read path selects the
--    right DEK by version.
-- 2. Multi-tenant / multi-region: separate DEKs per tenant or per
--    region can coexist in one table without changing the
--    application code.
-- 3. Auditability: the operator can see when each DEK was
--    generated, by whom (via kek_fingerprint), and which one is
--    currently active, all from one query.
--
-- KEK fingerprint
-- ---------------
-- `kek_fingerprint` is SHA-256(PII_MASTER_KEY), truncated to 16 hex
-- chars. It is safe to log and is intended for verification only —
-- "is the KEK in env the one I think it is?". An operator
-- generating a new DEK (`scripts/generate-pii-dek.ts`) prints the
-- fingerprint next to the wrapped DEK; they paste the SQL with the
-- matching fingerprint and the fingerprint in env will match.
--
-- NOT seeded by this migration
-- ----------------------------
-- This migration creates the table but does not insert the initial
-- row. The seed is operator-driven because the DEK and KEK both
-- belong to the operator's secrets manager. The runbook in
-- docs/security/pii-encryption.md describes the steps:
--   1. Generate PII_MASTER_KEY (32 random bytes, base64).
--   2. Run `tsx scripts/generate-pii-dek.ts` to produce a wrapped
--      DEK, the KEK fingerprint, and a SQL INSERT statement.
--   3. Apply this migration to create the table.
--   4. Execute the SQL INSERT against the new table.
--   5. Set PII_DATA_KEY=wrapped_dek in env so the app can boot
--      before the DB is reachable (e.g. for the backfill script).
--
-- During the transition period, rows encrypted by the legacy P0-3
-- single-key scheme are still decrypted using PII_ENCRYPTION_KEY
-- (see src/lib/security/pii-crypto.ts `decryptLegacy`). The
-- backfill script (scripts/backfill-pii-encryption.ts) re-writes
-- those rows under the new envelope format. Once the backfill
-- reports zero legacy rows remaining, the operator can drop
-- PII_ENCRYPTION_KEY and PII_HMAC_KEY from env in a follow-up.

BEGIN;

CREATE TABLE IF NOT EXISTS pii_keys (
  id              BIGSERIAL PRIMARY KEY,
  -- Bumped on every rotation. The ciphertext's second byte
  -- references this number so the read path picks the right DEK.
  -- Version 1 is the Phase-5 envelope scheme. Version 2+ is
  -- reserved for a future KMS migration.
  key_version     SMALLINT NOT NULL UNIQUE
                  CHECK (key_version > 0),
  -- The DEK encrypted under the KEK with AES-256-KW, base64-encoded.
  -- For a 32-byte DEK, the wrapped form is 40 bytes (320 bits).
  -- Validated by the application before use (the AES-KW integrity
  -- check rejects tampered values).
  wrapped_dek     TEXT NOT NULL,
  -- SHA-256(PII_MASTER_KEY) truncated to 16 hex chars. Lets the
  -- operator verify the KEK in env matches the KEK that wrapped
  -- this DEK without storing the KEK itself.
  kek_fingerprint CHAR(16) NOT NULL,
  -- Optional human-readable label, e.g. "phase5-prod-2026-10-03".
  label           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Exactly one row is the active DEK at any time. The application
  -- queries `WHERE is_active = true LIMIT 1` (or, in this phase,
  -- reads PII_DATA_KEY from env) to pick the DEK for new writes.
  -- Reads of historical ciphertexts use the version byte in the
  -- ciphertext to look up the matching DEK regardless of is_active.
  is_active       BOOLEAN NOT NULL DEFAULT false,

  -- Defensive: exactly one active row at a time.
  CONSTRAINT pii_keys_one_active
    EXCLUDE (is_active WITH =) WHERE (is_active)
);

-- Partial unique index: only one "active" row can exist at a time.
-- (The EXCLUDE constraint above enforces this; the index is a
-- redundant safety net for old query planners.)
CREATE UNIQUE INDEX IF NOT EXISTS uq_pii_keys_one_active
  ON pii_keys (is_active)
  WHERE is_active;

-- Helpful for "which DEK did this version use?" lookups during a
-- rotation window.
CREATE INDEX IF NOT EXISTS idx_pii_keys_version
  ON pii_keys (key_version);

COMMENT ON TABLE pii_keys IS
  'Wrapped data encryption keys for PII columns. Each row is a DEK '
  'encrypted (wrapped) by the master key in PII_MASTER_KEY env using '
  'AES-256-KW (RFC 3394). See src/lib/security/pii-crypto.ts.';

COMMENT ON COLUMN pii_keys.key_version IS
  'Monotonic per-deployment DEK version. Embedded as the second byte '
  'of the envelope ciphertext so the read path picks the right DEK.';

COMMENT ON COLUMN pii_keys.wrapped_dek IS
  'Base64 AES-256-KW ciphertext. Unwrap with PII_MASTER_KEY.';

COMMENT ON COLUMN pii_keys.kek_fingerprint IS
  'SHA-256(PII_MASTER_KEY) truncated to 16 hex chars. Verification only.';

COMMIT;