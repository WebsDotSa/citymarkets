-- 050b_create_order_status_logs.sql
-- Purpose: ensure the order_status_logs table exists before migration
--          051 runs. On production this table was created manually
--          before the migration runner existed (so 051's ADD COLUMN
--          IF NOT EXISTS is a no-op there). On fresh DBs (CI, staging,
--          new-region deploys) this file creates the table so 051's
--          ALTER succeeds.
--
-- Filename ordering note: lex order puts 050b before 051_*, so this
-- runs BEFORE 051. If you're adding migrations around here, use a
-- prefix that preserves this ordering (e.g. 050c, 051_0).

BEGIN;

CREATE TABLE IF NOT EXISTS order_status_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  old_status order_status_enum,
  new_status order_status_enum NOT NULL,
  -- Free-text actor label. Legacy rows store 'driver' or an admin name
  -- here. New writes should set changed_by_admin_id and leave this
  -- NULL (migration 051 adds that FK).
  changed_by TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_order_status_logs_order
  ON order_status_logs (order_id, created_at DESC);

-- Partial index for the most common lookup: "show me the latest
-- transition for this order" — already covered by the index, but
-- explicit helps the planner.
CREATE INDEX IF NOT EXISTS idx_order_status_logs_new_status
  ON order_status_logs (new_status);

COMMIT;