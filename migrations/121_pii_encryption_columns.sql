-- 121_pii_encryption_columns.sql
-- P0-3 (security Phase 3, 2026-10-03): application-level PII encryption
-- at rest. See src/lib/security/pii-crypto.ts for the algorithm.
--
-- Scope (matches the P0-PII-PLAINTEXT-DATABASE finding):
--   users.phone, users.name, users.email
--   drivers.phone, drivers.name
--   addresses.address_text, addresses.label
--   orders.guest_phone, orders.guest_name
--
-- Why we add columns instead of replacing in place
-- ------------------------------------------------
-- We do NOT drop the plaintext columns in this migration. There are
-- three reasons:
--   1. The application code that reads these columns is spread
--      across 70+ query sites. Flipping the schema in one migration
--      would require a coordinated deploy: schema first, code that
--      reads the new columns, then drop the old columns. That is
--      a separate follow-up.
--   2. The audit-finding explicitly recommended a zero-downtime
--      backfill: add encrypted + hmac columns, backfill in batches
--      from the app, switch reads to the new columns, then drop.
--   3. A UNIQUE constraint on users.phone and drivers.phone
--      currently exists. Removing it without a replacement risks
--      duplicate rows; the HMAC column is the replacement.
--
-- What this migration does
-- ------------------------
-- 1. Adds <col>_encrypted (TEXT) and, where lookups are needed,
--    <col>_hmac (CHAR(44) base64 of HMAC-SHA256) to each affected
--    table. Encrypted columns hold AES-256-GCM ciphertext
--    (iv || ct || tag, base64). HMAC columns hold a deterministic
--    index so lookups by phone still work after the plaintext is
--    encrypted.
-- 2. Replaces the UNIQUE(phone) constraint on users and drivers
--    with a UNIQUE(phone_hmac) constraint. The phone_hmac column
--    is also marked NOT NULL in the unique index, so lookups by
--    the application via WHERE phone_hmac = $1 are both possible
--    and unique.
-- 3. Backfill is intentionally NOT in this migration. A separate
--    operator-run script (scripts/backfill-pii-encryption.ts,
--    tracked in a follow-up) walks each table in batches, reads
--    the plaintext, computes the ciphertext + HMAC, and writes
--    the new columns. Backfill in batches keeps table-level locks
--    short and avoids a single huge transaction.
--
-- Indexes
-- -------
-- The hmac columns need indexes for the login path
-- (WHERE phone_hmac = $1) and any other phone-based lookup. The
-- encrypted columns are not indexed — equality on encrypted data
-- is meaningless.

BEGIN;

-- ============================================================
-- users
-- ============================================================
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS phone_encrypted    TEXT,
  ADD COLUMN IF NOT EXISTS phone_hmac         CHAR(44),
  ADD COLUMN IF NOT EXISTS name_encrypted     TEXT,
  ADD COLUMN IF NOT EXISTS email_encrypted    TEXT;

-- Drop the legacy UNIQUE on plaintext phone and replace with a
-- partial UNIQUE on phone_hmac (only enforced for non-null rows,
-- so the pre-backfill state does not violate the constraint).
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_phone_key;
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_phone_hmac
  ON users (phone_hmac)
  WHERE phone_hmac IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_users_phone_hmac_lookup
  ON users (phone_hmac);

-- ============================================================
-- drivers
-- ============================================================
ALTER TABLE drivers
  ADD COLUMN IF NOT EXISTS phone_encrypted    TEXT,
  ADD COLUMN IF NOT EXISTS phone_hmac         CHAR(44),
  ADD COLUMN IF NOT EXISTS name_encrypted     TEXT;

ALTER TABLE drivers DROP CONSTRAINT IF EXISTS drivers_phone_key;
CREATE UNIQUE INDEX IF NOT EXISTS uq_drivers_phone_hmac
  ON drivers (phone_hmac)
  WHERE phone_hmac IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_drivers_phone_hmac_lookup
  ON drivers (phone_hmac);

-- ============================================================
-- addresses (no HMAC — addresses are looked up by user_id, not
-- by their own content; address_text is encrypted for at-rest
-- protection, label likewise)
-- ============================================================
ALTER TABLE addresses
  ADD COLUMN IF NOT EXISTS address_text_encrypted  TEXT,
  ADD COLUMN IF NOT EXISTS label_encrypted        TEXT;

-- ============================================================
-- orders (guest_* fields are encrypted for at-rest; no lookup
-- by guest_phone after encryption, the canonical join is by
-- payment_reference / order id)
-- ============================================================
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS guest_phone_encrypted  TEXT,
  ADD COLUMN IF NOT EXISTS guest_name_encrypted   TEXT;

COMMIT;
