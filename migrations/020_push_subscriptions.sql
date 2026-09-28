-- 020_push_subscriptions.sql
-- Purpose: store web push subscriptions so we can send order updates
--          when a customer's order status changes.
-- Owner: citymarket_user. RLS open — the API keys the subscription to
--        the user (when logged in) and to the device endpoint.

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id          BIGSERIAL PRIMARY KEY,
  endpoint    TEXT NOT NULL UNIQUE,
  p256dh      TEXT NOT NULL,
  auth        TEXT NOT NULL,
  user_id     UUID,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_push_subs_user ON push_subscriptions (user_id);

ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE push_subscriptions FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "push_subs_read" ON push_subscriptions;
DROP POLICY IF EXISTS "push_subs_modify" ON push_subscriptions;
CREATE POLICY "push_subs_read"   ON push_subscriptions FOR SELECT USING (true);
CREATE POLICY "push_subs_modify" ON push_subscriptions FOR ALL WITH CHECK (true);

GRANT ALL ON push_subscriptions TO citymarket_user;
GRANT USAGE, SELECT ON SEQUENCE push_subscriptions_id_seq TO citymarket_user;
