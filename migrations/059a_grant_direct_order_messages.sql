-- Migration 059: Grant SELECT on direct_order_messages to citymarket_user.
-- Migration 053 created the table but didn't grant permissions, causing
-- /api/admin/orders/direct (and any chat-thread listing) to 500 with
-- "permission denied for table direct_order_messages".
-- See memory note admin_page_error_spin_and_orders_column_mismatch.
-- Must be run as postgres (table owner) — see scripts/migrate.ts notes.
BEGIN;

GRANT SELECT ON direct_order_messages TO citymarket_user;

COMMIT;
