-- User OTP verification table for phone authentication
-- This table stores one-time passwords for phone verification

CREATE TABLE IF NOT EXISTS user_otps (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code VARCHAR(10) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  verified_at TIMESTAMPTZ,
  attempts INTEGER DEFAULT 0 NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One OTP per user at a time
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_otps_user ON user_otps(user_id);

-- Index for cleanup of expired OTPs
CREATE INDEX IF NOT EXISTS idx_user_otps_expires ON user_otps(expires_at);

-- Function to clean up expired OTPs (can be called via pg_cron)
CREATE OR REPLACE FUNCTION cleanup_expired_otps()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM user_otps WHERE expires_at < NOW();
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Add comment for documentation
COMMENT ON TABLE user_otps IS 'Stores one-time passwords for phone-based authentication';
COMMENT ON COLUMN user_otps.user_id IS 'Reference to the user (unique constraint - one OTP per user)';
COMMENT ON COLUMN user_otps.code IS 'The OTP code (typically 4-6 digits)';
COMMENT ON COLUMN user_otps.expires_at IS 'When this OTP expires (typically 5 minutes after creation)';
COMMENT ON COLUMN user_otps.verified_at IS 'When the user successfully verified with this OTP';
COMMENT ON COLUMN user_otps.attempts IS 'Number of failed verification attempts';
