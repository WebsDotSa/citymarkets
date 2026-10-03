-- 082 — Drop the orphaned 'paid' value from order_status_enum.
--
-- Background:
--   Migration 033 added 'paid' to order_status_enum to fix a webhook
--   bug that was writing `'paid'` into `orders.status` on a successful
--   payment (the column was meant to track lifecycle, not payment —
--   payment lives in `orders.payment_status`).
--
--   The webhook was later rewritten (P0-3 fix in
--   `src/app/api/v1/payments/webhook/route.ts`) to use CASE-guarded
--   regression protection + lifecycle roll-forward
--   `pending → confirmed`, so 'paid' stopped being written to
--   `orders.status`. The enum value has been dead since then.
--
--   State machine audit (2026-09-30): the central state machine
--   (`src/lib/orders/state-machine.ts`) does NOT include 'paid' in
--   `ALL_ORDER_STATES` and no route writes it. The audit P1-1
--   finding recommends removing it from the enum so the DB schema
--   matches the application schema 1:1.
--
-- Safety:
--   - Refuse to run if any `orders.status = 'paid'` row exists —
--     the operator must manually reassign those rows (e.g. to
--     'confirmed') before re-running. Historical totals / loyalty
--     credits are unaffected because `payment_status` carries the
--     payment truth; `orders.status` only carries the lifecycle.
--
-- PCP-109 (2026-10-01): PostgreSQL has no `ALTER TYPE ... DROP VALUE`;
-- the original statement was a syntax error, so this file never
-- applied on any database. Enforce the same invariant with a CHECK
-- instead: the enum label stays (removing it needs a full type
-- rebuild) but no row can ever hold it. The guard above already
-- proved zero 'paid' rows.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM orders WHERE status = 'paid') THEN
    RAISE EXCEPTION
      'orders.status=''paid'' is non-empty (% rows). Reassign those rows to a live state (e.g. ''confirmed'') and re-run.',
      (SELECT COUNT(*) FROM orders WHERE status = 'paid');
  END IF;
END $$;

ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_not_paid;
ALTER TABLE orders
  ADD CONSTRAINT orders_status_not_paid CHECK (status <> 'paid');
