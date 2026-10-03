-- ════════════════════════════════════════════════════════════════════════════
-- PCP-109 (2026-10-01): RAISE EXCEPTION message joined into one literal
-- ('a' || 'b' is a PL/pgSQL syntax error; this file never applied on
-- any database).
-- P2-8 (full-system audit 2026-09-30) — drop dead service_fee column
-- ════════════════════════════════════════════════════════════════════════════
--
-- Migration 053 added `orders.service_fee_acknowledged_at TIMESTAMP` as a
-- parallel record of the customer's service-fee acknowledgement (the
-- canonical "I paid the 4 SAR service fee" record lives on
-- `direct_order_meta.fee_acknowledged BOOLEAN`, which IS read by the
-- `/api/v1/orders/[id]` route).
--
-- Audit grep across the entire repo:
--   - `service_fee_acknowledged_at` is WRITTEN by exactly one site:
--     src/app/api/v1/orders/direct/route.ts (in the INSERT into orders).
--   - It is NEVER read anywhere — no admin/analytics/customer/order-list
--     query surfaces it; no PDF/CSV export uses it; no test asserts on it.
--   - `direct_order_meta.fee_acknowledged` is the single source of truth
--     that /api/v1/orders/[id] returns to clients.
--
-- Consequence: the column is dead storage. It accumulates a timestamp per
-- direct order but nothing surfaces or audits it. Drop it.
--
-- Safety: empty-row pre-check, mirroring the migration 077 (banners) +
-- 083 (direct_orders/coupon_id/loyalty_transactions.order_id) +
-- 084 (reviews) pattern. Idempotent: re-running on a database that
-- already had this drop applied is a no-op (`DROP COLUMN IF EXISTS`).

BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'orders'
       AND column_name = 'service_fee_acknowledged_at'
  ) THEN
    -- The column was nullable + write-only. Confirm no non-NULL rows
    -- exist (if any do, they were written by the one INSERT that
    -- populated it; they're orphaned since no consumer reads them).
    -- We refuse the drop if any rows carry a timestamp so the
    -- operator can audit before proceeding.
    IF EXISTS (
      SELECT 1 FROM orders WHERE service_fee_acknowledged_at IS NOT NULL LIMIT 1
    ) THEN
      RAISE EXCEPTION
        'orders.service_fee_acknowledged_at still holds % non-NULL rows; auditing required before drop (no consumer reads this column, so the values are orphaned).',
        (SELECT COUNT(*) FROM orders WHERE service_fee_acknowledged_at IS NOT NULL);
    END IF;
    ALTER TABLE orders DROP COLUMN service_fee_acknowledged_at;
    RAISE NOTICE 'P2-8 cleanup: dropped orders.service_fee_acknowledged_at';
  ELSE
    RAISE NOTICE 'P2-8 cleanup: orders.service_fee_acknowledged_at already absent';
  END IF;
END $$;

COMMIT;
