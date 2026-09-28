-- Migration: Multi-vendor unified checkout (Slice 3)
-- Date: 2026-07-31
--
-- Why:
--   Slice 3 collapses a mixed cart (catalog + N vendors) into ONE parent
--   `orders` row + N `vendor_orders` rows. The schema needs:
--     1. vendor_orders.parent_order_id FK so children can be linked back
--        to the parent. ON DELETE SET NULL means a parent hard-delete
--        doesn't cascade-delete the children's business records.
--     2. vendor_orders.idempotency_key UNIQUE — same anti-duplicate
--        pattern as orders.idempotency_key (migration 034). The route
--        sets it to `<parent_key>:<vendor_slug>` so a replay of the
--        same parent checkout doesn't insert a duplicate child row.
--     3. orders.catalog_subtotal DECIMAL(10,2) — the webhook needs to
--        award loyalty based on the catalog portion only (coupons and
--        loyalty redemption apply only to the catalog subtotal). On
--        every pre-migration order the catalog subtotal IS the entire
--        subtotal, so we backfill from `subtotal`.
--     4. vendor_orders.payment_method CHECK expanded to include the
--        same unified tokens the catalog orders accept ('cash', 'card',
--        'wallet', 'mada', 'visa', 'mastercard', 'stc_pay', 'apple_pay',
--        'amex'). The previous expansion (migration 033) was missing
--        'cash' and 'wallet' for the cash/wallet payment flows.
--
-- All changes are idempotent and safe to re-run.

-- 1. Link vendor_orders → orders (parent dashboard + webhook fan-out)
ALTER TABLE vendor_orders
  ADD COLUMN IF NOT EXISTS parent_order_id UUID
    REFERENCES orders(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_vendor_orders_parent
  ON vendor_orders(parent_order_id)
  WHERE parent_order_id IS NOT NULL;

-- 2. vendor_orders idempotency key (backstop against duplicate inserts)
ALTER TABLE vendor_orders
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'vendor_orders'
      AND indexname = 'vendor_orders_idempotency_key_key'
  ) THEN
    ALTER TABLE vendor_orders
      ADD CONSTRAINT vendor_orders_idempotency_key_key
      UNIQUE (idempotency_key);
  END IF;
END
$$;

-- 3. orders.catalog_subtotal — the slice of the order total that
--    belongs to the City Markets catalog. Loyalty earn is calculated
--    on this column, not on the grand `subtotal`, so points from
--    vendor orders never leak into the City's loyalty economy.
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS catalog_subtotal NUMERIC(10, 2) NOT NULL DEFAULT 0;

-- Backfill existing rows: every pre-Slice-3 order is catalog-only,
-- so catalog_subtotal == subtotal. New rows from the unified checkout
-- will set it explicitly to the catalog group subtotal.
UPDATE orders
  SET catalog_subtotal = subtotal
  WHERE catalog_subtotal = 0 AND subtotal > 0;

-- 4. Expand vendor_orders.payment_method CHECK to cover the same
--    tokens the customer checkout uses. Pre-Slice-3 vendor checkouts
--    only sent 'cod' / 'moyasar_*'; the new unified checkout can send
--    any of the catalog tokens.
ALTER TABLE vendor_orders
  DROP CONSTRAINT IF EXISTS vendor_orders_payment_method_check;

ALTER TABLE vendor_orders
  ADD CONSTRAINT vendor_orders_payment_method_check
  CHECK (payment_method IN (
    -- Legacy vendor tokens (pre-Slice-3)
    'moyasar_card',
    'moyasar_applepay',
    'cod',
    -- Modern Moyasar tokens (migration 033)
    'card',
    'mada',
    'visa',
    'mastercard',
    'amex',
    'applepay',
    'stcpay',
    -- Unified catalog tokens (cash/wallet weren't in 033)
    'cash',
    'wallet',
    'stc_pay',
    'apple_pay',
    -- Catch-all for provider-specific values
    'other'
  ));

-- 5. orders.payment_method CHECK — the column is VARCHAR(32) with no
--    constraint, so no DB change is needed. The catalog tokens
--    ('cash', 'mada', 'visa', ...) pass through freely.

-- 6. ANALYZE so the planner can use the new indexes on first read.
ANALYZE vendor_orders;
ANALYZE orders;
