-- 071_phase2_indexes.sql
-- Purpose: Add the explicit indexes the user called out as performance
--          gaps during Phase 2 planning, plus a few correlated ones the
--          audit surfaced.
--
-- Why now (Phase 2 / P0):
--   Phase 2's OrderTimeline component + driver-earnings aggregations
--   will hit `orders(driver_id, ...)` and `order_status_logs(order_id,
--   created_at)` constantly. Pre-creating these indexes avoids the
--   first-day-of-traffic regressions the user warned about.
--
-- Pattern matches migration 070: BEGIN/COMMIT, IF NOT EXISTS, idx_<table>_<cols>.
-- Idempotent — re-running this file is a no-op.

BEGIN;

-- (a) users(email) — b-tree on lower(email) (mirrors the admin_users
--     pattern in migration 003 / 066). Lookup by email for password reset,
--     account merge, and the customer's account-deletion flow.
CREATE INDEX IF NOT EXISTS idx_users_email_lower
  ON users (LOWER(email)) WHERE email IS NOT NULL;

-- (b) addresses(user_id, is_default) — non-partial composite. The existing
--     partial index at 012:46 only helps queries that filter is_default=true;
--     any general "addresses for this user" lookup still scans.
CREATE INDEX IF NOT EXISTS idx_addresses_user_default_full
  ON addresses (user_id, is_default DESC);

-- (c) cart(user_id, updated_at DESC) — the "recent cart for user" query.
--     (The user spec called this cart_items but the table is `cart` —
--     using the real table name.)
CREATE INDEX IF NOT EXISTS idx_cart_user_updated
  ON cart (user_id, updated_at DESC);

-- (d) orders(user_id, created_at DESC) — non-composite version.
--     idx_orders_user_status_date (012:5) only helps when status is also
--     filtered. Customer order history lists show all statuses.
CREATE INDEX IF NOT EXISTS idx_orders_user_created
  ON orders (user_id, created_at DESC);

-- (e) vendor_orders(driver_id) — confirmed in Phase 1 audit that this
--     column doesn't exist. Driver assignment lives on `orders.driver_id`
--     only; vendor_orders tracks vendor-prepared fulfillment, not
--     customer delivery. SKIPPED.

-- (g) order_status_logs(order_id, created_at) — explicit composite for
--     the new /api/orders/[id]/timeline endpoint. Existing index
--     idx_order_status_logs_order (050b) covers order_id alone; adding
--     (order_id, created_at) lets the timeline endpoint serve
--     chronological rows without an extra sort step.
CREATE INDEX IF NOT EXISTS idx_order_status_logs_order_created
  ON order_status_logs (order_id, created_at);

ANALYZE users;
ANALYZE addresses;
ANALYZE cart;
ANALYZE orders;
ANALYZE order_status_logs;

COMMIT;