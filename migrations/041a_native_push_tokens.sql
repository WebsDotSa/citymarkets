-- 041_native_push_tokens.sql
-- Purpose: store APNs (iOS) and FCM (Android) device tokens for native
--          push notifications. Complements the existing web push
--          subscriptions table (migrations/020_push_subscriptions.sql).
-- Owner: citymarket_user. RLS open — the API binds the token to the
--        authenticated user_id (or guest=NULL) and inserts from a
--        bearer-authenticated POST. Reads are restricted to the same
--        user.

CREATE TABLE IF NOT EXISTS native_push_tokens (
  id              BIGSERIAL PRIMARY KEY,
  -- 'apns' (iOS) or 'fcm' (Android). Encoded as text rather than an
  -- enum so vendor-specific rollout (e.g. Huawei HMS) only needs an
  -- additive migration to support a new value.
  platform        TEXT NOT NULL CHECK (platform IN ('apns', 'fcm')),
  -- The opaque device token returned by APNs.registerForRemoteNotifications
  -- or FirebaseMessaging.getToken(). Hex-encoded for safe transport.
  device_token    TEXT NOT NULL,
  -- Optional environment: 'production' | 'sandbox'. APNs uses
  -- 'sandbox' for TestFlight builds; omitted for FCM.
  environment     TEXT,
  -- Bundle / application id, e.g. com.citymarkets.app. Lets us share
  -- the table across multiple branded apps in the future.
  bundle_id       TEXT,
  -- The most recent hex-encoded device locale (e.g. 'ar-SA') so the
  -- client doesn't have to round-trip for every push.
  locale          TEXT,
  user_id         UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- A token is unique per (platform, device_token) tuple. The same
  -- user can install on multiple devices; the same token can be
  -- re-registered against a different user if the device is sold.
  UNIQUE (platform, device_token)
);

CREATE INDEX IF NOT EXISTS idx_native_push_tokens_user
  ON native_push_tokens (user_id);
CREATE INDEX IF NOT EXISTS idx_native_push_tokens_platform
  ON native_push_tokens (platform);

ALTER TABLE native_push_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE native_push_tokens FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "native_push_tokens_select" ON native_push_tokens;
DROP POLICY IF EXISTS "native_push_tokens_modify" ON native_push_tokens;
-- App-layer is the only writer; SELECT keeps the table from being
-- completely opaque to posterous dashboards.
CREATE POLICY "native_push_tokens_select" ON native_push_tokens
  FOR SELECT USING (true);
CREATE POLICY "native_push_tokens_modify" ON native_push_tokens
  FOR ALL WITH CHECK (true);

GRANT ALL ON native_push_tokens TO citymarket_user;
GRANT USAGE, SELECT ON SEQUENCE native_push_tokens_id_seq TO citymarket_user;
