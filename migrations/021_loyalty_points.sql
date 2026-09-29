-- 021_loyalty_points.sql
-- Purpose: customer loyalty / rewards system.
--          EARN rate: 1 point per 1 SAR on completed orders.
--          REDEEM rate: 100 points = 5 SAR discount at checkout.
-- Owner: citymarket_user. RLS open — the API validates user identity
--        via the existing customer auth helper.
--
-- FIX 2026-07-29: original wrote `order_id` column on loyalty_transactions
-- but the actual schema (after 022 + later refactors) uses
-- `ref_order_id`. The CREATE TABLE is a no-op (IF NOT EXISTS), but the
-- downstream index + GRANT referenced the missing column / sequence.
-- We rewrite the dependent statements against the live schema while
-- preserving the migration's intent (loyalty tables, RLS open,
-- grants to citymarket_user).

CREATE TABLE IF NOT EXISTS loyalty_points (
  user_id            UUID PRIMARY KEY,
  balance            INTEGER NOT NULL DEFAULT 0 CHECK (balance >= 0),
  lifetime_earned    INTEGER NOT NULL DEFAULT 0,
  lifetime_redeemed  INTEGER NOT NULL DEFAULT 0,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 001 already created loyalty_transactions with id (UUID), user_id,
-- points, type (enum), ref_order_id, created_at. The CREATE TABLE
-- below is a no-op on a fresh DB, but the indexes that follow need
-- `reason`, `balance_after`, and an `order_id` column. Add them as
-- ADD COLUMN IF NOT EXISTS so the indexes always have a column to
-- point at. Safe to re-run on production where the columns already
-- exist (005 added internal_notes to orders with the same pattern).
ALTER TABLE loyalty_transactions ADD COLUMN IF NOT EXISTS reason        TEXT;
ALTER TABLE loyalty_transactions ADD COLUMN IF NOT EXISTS balance_after INTEGER;
ALTER TABLE loyalty_transactions ADD COLUMN IF NOT EXISTS order_id      UUID;

CREATE TABLE IF NOT EXISTS loyalty_transactions (
  id             BIGSERIAL PRIMARY KEY,
  user_id        UUID NOT NULL,
  delta          INTEGER NOT NULL,
  reason         TEXT NOT NULL CHECK (reason IN ('earn','redeem','bonus','expire','adjust')),
  order_id       UUID,
  balance_after  INTEGER NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Real table is created by an earlier migration with ref_order_id instead
-- of order_id. Both indexes below reference whatever the live table has.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'loyalty_transactions'
      AND column_name = 'ref_order_id'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_loyalty_tx_ref_order ON loyalty_transactions (ref_order_id)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_loyalty_tx_reason    ON loyalty_transactions (reason)';
  ELSE
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_loyalty_tx_order  ON loyalty_transactions (order_id)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_loyalty_tx_reason ON loyalty_transactions (reason)';
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_loyalty_tx_user ON loyalty_transactions (user_id, created_at DESC);

ALTER TABLE loyalty_points        ENABLE ROW LEVEL SECURITY;
ALTER TABLE loyalty_transactions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE loyalty_points        FORCE ROW LEVEL SECURITY;
ALTER TABLE loyalty_transactions   FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "loyalty_points_rw"   ON loyalty_points;
DROP POLICY IF EXISTS "loyalty_transactions_rw" ON loyalty_transactions;
-- FIX 2026-07-29: PG rejects `FOR ALL WITH CHECK (...) USING (...)` —
-- the correct order is USING first, then WITH CHECK per the grammar:
--   CREATE POLICY ... FOR ALL USING (...) WITH CHECK (...);
CREATE POLICY "loyalty_points_rw"        ON loyalty_points      FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "loyalty_transactions_rw"   ON loyalty_transactions FOR ALL USING (true) WITH CHECK (true);

GRANT ALL ON loyalty_points        TO citymarket_user;
GRANT ALL ON loyalty_transactions   TO citymarket_user;

-- Sequence grant guard: loyalty_transactions.id is uuid-generated in
-- the live schema, so the bigserial sequence may not exist. Grant
-- inside a DO block to avoid failing when the relation is absent.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class
    WHERE relkind = 'S' AND relname = 'loyalty_transactions_id_seq'
  ) THEN
    EXECUTE 'GRANT USAGE, SELECT ON SEQUENCE loyalty_transactions_id_seq TO citymarket_user';
  END IF;
END $$;
