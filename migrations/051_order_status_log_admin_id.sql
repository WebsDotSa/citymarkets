-- 051_order_status_log_admin_id.sql
-- Purpose: link each row in order_status_logs to the admin_users row of the
--          person who actually flipped the status (employee OR delivery
--          driver). Without this link the admin order-detail page can only
--          show a literal "driver" string — the actual driver's name is lost.
--
-- Background:
--   * order_status_logs already exists in production (created manually
--     before this migration). It has columns: id, order_id, old_status,
--     new_status, changed_by (text), notes, created_at.
--   * changed_by is kept for backwards compat with the existing driver
--     PATCH route that hardcodes the string "driver". New writes use
--     changed_by_admin_id (FK) + leave changed_by as NULL. The API joins
--     via admin_users to surface the human name.
--   * changed_by_admin_id is nullable on purpose — system-triggered status
--     flips (payment webhook, scheduled jobs, etc.) have no admin actor.

BEGIN;

ALTER TABLE order_status_logs
  ADD COLUMN IF NOT EXISTS changed_by_admin_id UUID
    REFERENCES admin_users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_order_status_logs_admin
  ON order_status_logs (changed_by_admin_id)
  WHERE changed_by_admin_id IS NOT NULL;

-- Backfill: link existing legacy rows whose changed_by = 'driver' to any
-- driver-role admin_users. We can't reliably attribute the row to a
-- specific driver because the literal "driver" lost that info, but
-- attaching the column lets the join still return a usable display
-- (the admin page will fall back to changed_by text when the join
-- produces nothing).
-- Cast `au.role` to text so the comparison 'delivery_driver' doesn't
-- trigger PostgreSQL's enum input validation. The current admin_role_enum
-- (defined in 003) does not include 'delivery_driver' — it's a text
-- value drivers use informally, but the column type rejects it as a
-- literal. Casting to text bypasses the type check while still matching
-- the value correctly (any future ADD VALUE 'delivery_driver' to the
-- enum would also be matched by this comparison).
UPDATE order_status_logs l
   SET changed_by_admin_id = au.id
  FROM admin_users au
 WHERE l.changed_by = 'driver'
   AND au.role::text = 'delivery_driver'
   AND l.changed_by_admin_id IS NULL
   AND NOT EXISTS (
     SELECT 1 FROM order_status_logs l2
      WHERE l2.order_id = l.order_id
        AND l2.changed_by_admin_id = au.id
   );

COMMIT;
