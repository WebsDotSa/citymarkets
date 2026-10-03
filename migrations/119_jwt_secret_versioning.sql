-- Migration 119: JWT Secret Versioning
-- Add table to track JWT secret versions for rotation support
-- Enables graceful secret rotation with N-day grace period
--
-- NOTE: The schema introduced by this migration (jwt_secrets table,
-- jwt_secret_rotations table, jwt_secret_version columns on users /
-- admin_users / vendor_staff) was never read by application code. The
-- existing token_version column from migration 027 already provides the
-- rotation invariant this migration duplicated. Migration 122
-- (122_jwt_secret_versioning_cleanup.sql) drops all of this dead schema.
-- This file is preserved for historical / audit traceability.

CREATE TABLE jwt_secrets (
  id SERIAL PRIMARY KEY,
  secret_type VARCHAR(50) NOT NULL,  -- 'customer', 'admin', 'vendor'
  secret_hash VARCHAR(255) NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  status VARCHAR(20) NOT NULL DEFAULT 'active',  -- 'active', 'deprecated', 'revoked'
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  expires_at TIMESTAMP WITH TIME ZONE,
  UNIQUE (secret_type, version)
);

-- Create index for fast secret type + status lookups
CREATE INDEX idx_jwt_secrets_type_status ON jwt_secrets(secret_type, status);

-- Add columns to track secret version for enhanced audit trail
ALTER TABLE users ADD COLUMN IF NOT EXISTS jwt_secret_version INTEGER DEFAULT 1;
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS jwt_secret_version INTEGER DEFAULT 1;
ALTER TABLE vendor_staff ADD COLUMN IF NOT EXISTS jwt_secret_version INTEGER DEFAULT 1;

-- Create audit log for secret rotations
CREATE TABLE IF NOT EXISTS jwt_secret_rotations (
  id SERIAL PRIMARY KEY,
  secret_type VARCHAR(50) NOT NULL,
  old_version INTEGER NOT NULL,
  new_version INTEGER NOT NULL,
  grace_period_days INTEGER DEFAULT 7,
  grace_period_ends_at TIMESTAMP WITH TIME ZONE,
  rotated_by VARCHAR(255),  -- admin ID or system
  reason TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Grant permissions
GRANT SELECT ON jwt_secrets TO service_role;
GRANT SELECT ON jwt_secret_rotations TO service_role;
