-- 018_order_tracking_code.sql
-- Purpose: Guests can't see their orders. We need a short tracking code that
--          can be entered on /orders/track (without auth) to look up an order
--          by phone + tracking code.
--
-- Approach:
--   * Add tracking_code column (6-digit numeric, unique when present).
--   * Backfill existing orders with a stable code derived from id.
--   * Add RLS policy: citymarket_user can SELECT by tracking_code (or all for
--     staff roles).

ALTER TABLE orders ADD COLUMN IF NOT EXISTS tracking_code text;

-- Backfill: 6-digit numeric from first 8 hex chars of md5(id), absolute value
-- to avoid negative codes, mod 1e6.
UPDATE orders
SET tracking_code = LPAD((ABS(('x' || substr(md5(id::text), 1, 8))::bit(32)::int) % 1000000)::text, 6, '0')
WHERE tracking_code IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_orders_tracking_code
  ON orders(tracking_code) WHERE tracking_code IS NOT NULL;

-- RLS: tracking lookup uses a separate function that bypasses RLS, so we don't
-- need a public SELECT policy. See API route.
