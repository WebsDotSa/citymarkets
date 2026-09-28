-- 022_order_loyalty.sql
-- Purpose: add loyalty fields to orders so we can track points redeemed
--          and the resulting discount. The payment webhook + admin status
--          updates read these to award/spend points.
-- Idempotent — safe to re-run.

ALTER TABLE orders ADD COLUMN IF NOT EXISTS points_redeemed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS points_discount  NUMERIC(10,2) NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS points_earned    INTEGER NOT NULL DEFAULT 0;
