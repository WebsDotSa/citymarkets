-- 026_loyalty_idempotency.sql
-- Purpose: ensure loyalty_transactions has the columns the application
--          code expects (ref_order_id, type) and add a UNIQUE constraint
--          to make loyalty-credit idempotent under concurrent webhooks.
--          The C4 vulnerability allowed two concurrent webhook calls to
--          both pass the "already awarded?" check and credit points twice.
--
-- Background:
--   * 001_full_schema.sql defined ref_order_id + type with an enum.
--   * 021_loyalty_points.sql redefined the table with order_id + reason.
--   This drift left the runtime code in webhook/route.ts referencing
--   columns that may not exist in some deployments. We reconcile here
--   by ensuring the application contract columns are present, then
--   lock down uniqueness on (ref_order_id, type).

-- Idempotent: add columns only if they don't exist.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'loyalty_transactions' AND column_name = 'ref_order_id'
  ) THEN
    ALTER TABLE loyalty_transactions
      ADD COLUMN ref_order_id UUID REFERENCES orders(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'loyalty_transactions' AND column_name = 'type'
  ) THEN
    DO $t$ BEGIN
      CREATE TYPE loyalty_tx_type_enum AS ENUM ('earn', 'redeem', 'adjust');
    EXCEPTION WHEN duplicate_object THEN NULL; END $t$;
    ALTER TABLE loyalty_transactions
      ADD COLUMN type loyalty_tx_type_enum;
  END IF;
END $$;

-- Backfill: if order_id was populated and ref_order_id is not, copy it.
UPDATE loyalty_transactions
SET ref_order_id = order_id
WHERE ref_order_id IS NULL AND order_id IS NOT NULL;

-- Index for the idempotency hot path.
CREATE UNIQUE INDEX IF NOT EXISTS uq_loyalty_tx_ref_order_type
  ON loyalty_transactions (ref_order_id, type)
  WHERE ref_order_id IS NOT NULL;
