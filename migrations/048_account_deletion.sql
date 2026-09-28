-- ════════════════════════════════════════════════════════════════════════════
-- 048_account_deletion.sql
-- Soft-delete support for /api/v1/profile/delete
--
-- Why soft-delete (NOT hard delete):
--   1. orders.user_id is ON DELETE RESTRICT (FK from migration 001).
--      Hard delete fails for any customer with order history.
--   2. Tax/legal hold: keep order rows immutable for accounting/audits.
--   3. PII anonymization still satisfies data-deletion requests (GDPR-style):
--      phone/name/email are wiped, the row stays as a tombstone.
--
-- Adds:
--   - users.deleted_at TIMESTAMP NULL
--   - partial unique index on users.phone WHERE deleted_at IS NULL
--     (lets the same phone re-register after deletion)
--   - partial index on users.deleted_at for fast filtering
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;

-- Replace the global UNIQUE(phone) constraint with a partial unique
-- index that only applies to live accounts. This way a deleted user can
-- sign up again with the same number, but two active users can never
-- share a phone.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'users_phone_key' AND conrelid = 'users'::regclass
  ) THEN
    ALTER TABLE users DROP CONSTRAINT users_phone_key;
  END IF;
END$$;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_users_phone_active
  ON users (phone)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_users_deleted_at
  ON users (deleted_at)
  WHERE deleted_at IS NOT NULL;