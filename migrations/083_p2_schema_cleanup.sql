-- ════════════════════════════════════════════════════════════════════════════
-- PCP-109 (2026-10-01): RAISE EXCEPTION format strings joined into single
-- literals (the `'a' || 'b'` form is a PL/pgSQL syntax error, so this
-- file never applied on any database). EXECUTE (SELECT ...) returns NULL
-- when no FK exists; wrap in COALESCE(..., 'SELECT 1') so it becomes a
-- no-op instead of erroring on the NULL command string.
-- P2 (full-system audit 2026-09-30) — schema cleanup
-- ════════════════════════════════════════════════════════════════════════════
--
-- Removes four categories of dead schema that the audit (plan at
-- /root/.claude/plans/reflective-whistling-harbor.md) flagged:
--
--   1. `direct_orders` table (001) — replaced by `direct_order_meta` in
--      migration 053. Zero references in `src/` — confirmed by grep
--      `FROM direct_orders|JOIN direct_orders|INTO direct_orders|UPDATE
--      direct_orders` returning 0 hits.
--
--   2. `orders.coupon_id` FK column (001) — coupon lookup has used
--      `orders.coupon_code` (text) since 006. Zero SELECT/INSERT/UPDATE
--      touches `orders.coupon_id` anywhere in `src/`. The TS interfaces
--      in `src/lib/types.ts:269,328` reference it but no SQL does.
--
--   3. `loyalty_transactions.order_id` parallel column (021) — replaced
--      by `ref_order_id` (the active column). `reason` (also added by
--      021) is NOT dead: `src/app/api/v1/spin/route.ts:188` writes to
--      it for spin-prize transactions. Keep `reason`, drop `order_id`.
--
--   4. `orders.payment_status` default — was `'unpaid'` (001, 006) but
--      the only writer is `create-checkout.ts:397` which always supplies
--      an explicit value. `'unpaid'` is not in the canonical
--      `PAYMENT_STATUSES_CONFIG` map either. Align the default with the
--      active set so a future INSERT without an explicit status lands on
--      the same enum value the rest of the app uses.
--
-- Safety: every DROP is gated by an empty-table / empty-column
-- pre-check so the migration refuses to run on a database that still
-- holds live data in the would-be-dropped structures. The same
-- pattern migration 077 (drop banners) used. Once the gates pass,
-- we drop; if any gate fails we RAISE EXCEPTION with a remediation
-- hint.
--
-- Idempotent: each statement uses `IF EXISTS` so re-running the
-- migration on a database that already had these drops applied is a
-- no-op (Postgres allows re-running DDL with `IF EXISTS`).

BEGIN;

-- ---- 1. `direct_orders` table ----
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'direct_orders'
  ) THEN
    IF EXISTS (SELECT 1 FROM direct_orders LIMIT 1) THEN
      RAISE EXCEPTION
        'direct_orders still holds rows; refusing to drop. Migrate data first.';
    END IF;
    DROP TABLE direct_orders;
    RAISE NOTICE 'P2 cleanup: dropped direct_orders';
  ELSE
    RAISE NOTICE 'P2 cleanup: direct_orders already absent';
  END IF;
END $$;

-- ---- 2. `orders.coupon_id` FK column ----
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'orders'
       AND column_name = 'coupon_id'
  ) THEN
    -- The column was nullable + had a SET NULL FK in 001, so backfill
    -- is not a concern. Just confirm no live rows depend on it before
    -- dropping.
    IF EXISTS (
      SELECT 1 FROM orders WHERE coupon_id IS NOT NULL LIMIT 1
    ) THEN
      RAISE EXCEPTION
        'orders.coupon_id still has non-NULL rows (% found); backfill to coupon_code first or run with care.',
        (SELECT COUNT(*) FROM orders WHERE coupon_id IS NOT NULL);
    END IF;
    -- Drop the FK constraint first (idempotent) so the column drop is clean.
    EXECUTE COALESCE((
      SELECT format(
        'ALTER TABLE orders DROP CONSTRAINT IF EXISTS %I',
        c.conname
      )
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY (c.conkey)
      WHERE t.relname = 'orders'
        AND c.contype = 'f'
        AND a.attname = 'coupon_id'
      LIMIT 1
    ), 'SELECT 1');  -- no FK present → no-op (PCP-109, 2026-10-01)
    ALTER TABLE orders DROP COLUMN coupon_id;
    RAISE NOTICE 'P2 cleanup: dropped orders.coupon_id';
  ELSE
    RAISE NOTICE 'P2 cleanup: orders.coupon_id already absent';
  END IF;
END $$;

-- ---- 3. `loyalty_transactions.order_id` parallel column ----
-- `reason` (also added by 021) is kept — see header comment.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'loyalty_transactions'
       AND column_name = 'order_id'
  ) THEN
    IF EXISTS (
      SELECT 1 FROM loyalty_transactions WHERE order_id IS NOT NULL LIMIT 1
    ) THEN
      RAISE EXCEPTION
        'loyalty_transactions.order_id still has non-NULL rows (% found); backfill to ref_order_id first.',
        (SELECT COUNT(*) FROM loyalty_transactions WHERE order_id IS NOT NULL);
    END IF;
    -- Drop any FK constraint pointing at orders(id) on this column first.
    EXECUTE COALESCE((
      SELECT format(
        'ALTER TABLE loyalty_transactions DROP CONSTRAINT IF EXISTS %I',
        c.conname
      )
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY (c.conkey)
      WHERE t.relname = 'loyalty_transactions'
        AND c.contype = 'f'
        AND a.attname = 'order_id'
      LIMIT 1
    ), 'SELECT 1');  -- no FK present → no-op (PCP-109, 2026-10-01)
    -- Drop the parallel index added by 021 too.
    DROP INDEX IF EXISTS idx_loyalty_tx_order;
    ALTER TABLE loyalty_transactions DROP COLUMN order_id;
    RAISE NOTICE 'P2 cleanup: dropped loyalty_transactions.order_id';
  ELSE
    RAISE NOTICE 'P2 cleanup: loyalty_transactions.order_id already absent';
  END IF;
END $$;

-- ---- 4. `orders.payment_status` default ----
-- Change from 'unpaid' to 'pending'. The DEFAULT only affects future
-- INSERTs that don't supply an explicit value — every checkout path
-- already writes explicitly via `create-checkout.ts:397`.
DO $$
BEGIN
  ALTER TABLE orders
    ALTER COLUMN payment_status SET DEFAULT 'pending';
  RAISE NOTICE 'P2 cleanup: orders.payment_status default set to pending';
END $$;

COMMIT;