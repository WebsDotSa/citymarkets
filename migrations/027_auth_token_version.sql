-- 027_auth_token_version.sql
-- Purpose: support instant revocation of admin/vendor/customer JWTs by
--          adding a monotonically increasing `token_version` column.
--          When auth is verified, the JWT's version is checked against
--          the DB version. Incrementing the version invalidates all
--          outstanding tokens for that principal without forcing a
--          role change.
--
-- Use cases:
--   * Admin demoted → token_version++ → existing JWTs rejected.
--   * Vendor suspended → token_version++ → existing JWTs rejected.
--   * Customer logged out everywhere → token_version++.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'admin_users' AND column_name = 'token_version'
  ) THEN
    ALTER TABLE admin_users
      ADD COLUMN token_version INTEGER NOT NULL DEFAULT 1;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'vendor_staff' AND column_name = 'token_version'
  ) THEN
    ALTER TABLE vendor_staff
      ADD COLUMN token_version INTEGER NOT NULL DEFAULT 1;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'token_version'
  ) THEN
    ALTER TABLE users
      ADD COLUMN token_version INTEGER NOT NULL DEFAULT 1;
  END IF;
END $$;
