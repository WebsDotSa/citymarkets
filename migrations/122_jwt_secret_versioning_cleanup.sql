-- Migration 122: JWT Secret Versioning Cleanup
-- Removes the dead jwt_secret_versioning schema introduced in migration 119.
-- The jwt_secrets / jwt_secret_rotations tables and the jwt_secret_version
-- columns on users / admin_users / vendor_staff were never read by any
-- application code. The pre-existing token_version column (migration 027)
-- already handles the rotation invariant. This migration drops the dead
-- schema so the audit surface and DB invariant checks stay clean.
--
-- Idempotent: every DROP uses IF EXISTS / IF EXISTS so re-running against
-- a partially-applied state is safe.

-- Drop the three duplicate version columns
ALTER TABLE users DROP COLUMN IF EXISTS jwt_secret_version;
ALTER TABLE admin_users DROP COLUMN IF EXISTS jwt_secret_version;
ALTER TABLE vendor_staff DROP COLUMN IF EXISTS jwt_secret_version;

-- Drop the two unused tables
DROP TABLE IF EXISTS jwt_secret_rotations;
DROP TABLE IF EXISTS jwt_secrets;
