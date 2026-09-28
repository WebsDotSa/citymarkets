-- 030_drivers_admin_link.sql
-- Purpose: link the `drivers` table to `admin_users` so that a
--          `delivery_driver`-role admin can only see / update
--          orders assigned to their driver record. Without this link,
--          every delivery_driver-role admin would see every delivery
--          order in the system (the previous behavior was effectively
--          "any driver can act on any order").
--
-- Background:
--   * admin_users.role = 'delivery_driver' carries the
--     view_delivery_orders / update_delivery_status permissions.
--   * orders.driver_id points to drivers.id (no auth linkage).
--   * This migration adds drivers.admin_user_id so the API can scope
--     queries: WHERE driver_id = (SELECT id FROM drivers WHERE admin_user_id = $adminId)
--     OR driver_id IS NULL (unassigned, available for pickup).

ALTER TABLE drivers
  ADD COLUMN IF NOT EXISTS admin_user_id UUID REFERENCES admin_users(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_drivers_admin_user
  ON drivers (admin_user_id)
  WHERE admin_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_orders_driver_id
  ON orders (driver_id)
  WHERE driver_id IS NOT NULL;