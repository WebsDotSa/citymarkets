-- 088: close the remaining functional gaps between the production schema
-- and the schema a fresh 001→087 chain produces (audit 2026-09-30).
--
-- Both shapes are wrong in different places, so every statement is
-- guarded and the file is a no-op wherever the target state already
-- holds.
--
-- A. addresses.user_id — fresh chain only
--    001 declares it NOT NULL, but guest checkout stores addresses with
--    `guest_key` and a NULL user_id (src/lib/identity/address-service.ts;
--    production already has such rows). On a fresh database every guest
--    address INSERT failed. Replace NOT NULL with the owner CHECK that
--    004 intended but never applied (its CREATE TABLE was a no-op).
--
-- B. orders.payment_reference uniqueness — production only
--    The partial unique index is the idempotency guard that stops one
--    gateway payment from being attached to two orders. Production never
--    got it.
--
-- C. guest_cart UNIQUE (session_id, product_id) — production only
--    Superseded by the vendor-aware unique index that the cart upsert's
--    ON CONFLICT targets; the old constraint can fire first and turn an
--    upsert into a 23505.
--
-- D. NOT NULL on cart / guest_cart keys — production only
--    The fresh chain has them; the cart code assumes them. Only applied
--    when no offending row exists.
--
-- E. Lookup indexes production is missing (orders, addresses, cart,
--    order_items, loyalty, OTP expiry, low-stock).

BEGIN;

-- A ─────────────────────────────────────────────────────────────────
ALTER TABLE addresses ALTER COLUMN user_id DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'addresses'::regclass AND conname = 'addresses_owner_check'
  ) THEN
    IF EXISTS (SELECT 1 FROM addresses WHERE user_id IS NULL AND guest_key IS NULL) THEN
      RAISE NOTICE '[088] addresses has ownerless rows; owner CHECK not added';
    ELSE
      ALTER TABLE addresses
        ADD CONSTRAINT addresses_owner_check
        CHECK (user_id IS NOT NULL OR guest_key IS NOT NULL);
    END IF;
  END IF;
END $$;

-- B ─────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF to_regclass('public.uniq_orders_payment_reference_active') IS NULL THEN
    IF EXISTS (
      SELECT 1 FROM orders WHERE payment_reference IS NOT NULL
       GROUP BY payment_reference HAVING COUNT(*) > 1
    ) THEN
      RAISE NOTICE '[088] duplicate orders.payment_reference values; unique index not created';
    ELSE
      CREATE UNIQUE INDEX uniq_orders_payment_reference_active
        ON orders (payment_reference) WHERE payment_reference IS NOT NULL;
    END IF;
  END IF;
END $$;

-- C ─────────────────────────────────────────────────────────────────
ALTER TABLE guest_cart DROP CONSTRAINT IF EXISTS guest_cart_session_product_unique;
DROP INDEX IF EXISTS guest_cart_session_product_unique;

-- D ─────────────────────────────────────────────────────────────────
DO $$
DECLARE
  target RECORD;
  has_nulls BOOLEAN;
BEGIN
  FOR target IN
    SELECT * FROM (VALUES
      ('cart', 'user_id'), ('cart', 'product_id'),
      ('cart', 'created_at'), ('cart', 'updated_at'),
      ('guest_cart', 'product_id'), ('guest_cart', 'created_at')
    ) AS t(tbl, col)
  LOOP
    EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I WHERE %I IS NULL)', target.tbl, target.col)
      INTO has_nulls;
    IF has_nulls THEN
      RAISE NOTICE '[088] %.% has NULL rows; NOT NULL skipped', target.tbl, target.col;
    ELSE
      EXECUTE format('ALTER TABLE %I ALTER COLUMN %I SET NOT NULL', target.tbl, target.col);
    END IF;
  END LOOP;
END $$;

-- E ─────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_orders_payment_ref
  ON orders (payment_reference);
CREATE INDEX IF NOT EXISTS idx_orders_payment_status
  ON orders (payment_status) WHERE payment_status <> 'paid';
CREATE INDEX IF NOT EXISTS idx_orders_status_date
  ON orders (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_user_status_date
  ON orders (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_order_items_order_product
  ON order_items (order_id, product_id);
CREATE INDEX IF NOT EXISTS idx_addresses_user_id
  ON addresses (user_id);
CREATE INDEX IF NOT EXISTS idx_addresses_user_default
  ON addresses (user_id, is_default DESC) WHERE is_default = true;
CREATE INDEX IF NOT EXISTS idx_cart_user_product
  ON cart (user_id, product_id);
CREATE INDEX IF NOT EXISTS idx_loyalty_tx_ref_order
  ON loyalty_transactions (ref_order_id);
CREATE INDEX IF NOT EXISTS idx_user_otps_expires
  ON user_otps (expires_at);
CREATE INDEX IF NOT EXISTS idx_products_low_stock
  ON products (category_id) WHERE is_active = true AND stock_qty <= 10;

COMMIT;
