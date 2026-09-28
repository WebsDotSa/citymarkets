-- 058_abandoned_carts.sql
-- Snapshot table for carts that reached checkout but did not complete
-- online payment. Captured at order creation time so the data survives
-- even after the live `cart` / `guest_cart` rows are deleted (post-order).
--
-- Lifecycle:
--   1. POST /api/v1/orders inserts a row with status='abandoned' once a
--      non-cash/wallet order is created. Snapshots are skipped for cash
--      and wallet orders because there is no payment gateway step that
--      can abandon.
--   2. When any payment gateway webhook (MyFatoorah, Tamara, Moyasar
--      confirm) flips payment_status to 'paid' for a NEW order created
--      by the same user/session, every other still-'abandoned' snapshot
--      for that actor is updated with status='recovered' and the new
--      recovered_order_id. The webhook then sends a personalised
--      confirmation message that mentions the recovered count.
--   3. The admin /admin/abandoned-carts page renders this table so staff
--      can see who started checkout but bounced.
--
-- Anonymous (guest) users are tracked via guest_phone / guest_session_id
-- which are captured from the request; we never log them to a profile
-- they didn't create.

BEGIN;

CREATE TABLE IF NOT EXISTS abandoned_carts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  guest_session_id VARCHAR(128),
  guest_name TEXT,
  guest_phone VARCHAR(32),
  items_count INTEGER NOT NULL CHECK (items_count > 0),
  subtotal NUMERIC(10,2) NOT NULL CHECK (subtotal >= 0),
  items JSONB NOT NULL,
  intent_order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'abandoned'
    CHECK (status IN ('abandoned', 'recovered')),
  recovered_order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_abandoned_user
  ON abandoned_carts(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_abandoned_session
  ON abandoned_carts(guest_session_id) WHERE guest_session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_abandoned_phone
  ON abandoned_carts(guest_phone) WHERE guest_phone IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_abandoned_status
  ON abandoned_carts(status);
CREATE INDEX IF NOT EXISTS idx_abandoned_last_seen
  ON abandoned_carts(last_seen_at DESC);
-- Idempotency on the intent order. POST /api/v1/orders is safe to retry
-- thanks to the orders.idempotency_key UNIQUE, but we still want a
-- backstop here so a webhook replay that triggers a recovery UPDATE
-- doesn't create duplicate snapshot rows.
CREATE UNIQUE INDEX IF NOT EXISTS uq_abandoned_intent_order
  ON abandoned_carts(intent_order_id) WHERE intent_order_id IS NOT NULL;

GRANT ALL ON abandoned_carts TO citymarket_user;

COMMIT;
