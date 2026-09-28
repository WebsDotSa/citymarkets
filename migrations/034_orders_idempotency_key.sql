-- Migration: Add idempotency_key column to orders
-- Date: 2026-07-30
--
-- Why:
--   The customer checkout submit button races against itself: a slow
--   network can make the button look unresponsive, so the user clicks
--   "تأكيد الطلب" again and we end up creating TWO orders + TWO Moyasar
--   invoices for the same cart. The first user to hit this gets an
--   orphaned second invoice — and in the worst case both succeed, which
--   means a real-money duplicate charge.
--
-- Fix: client generates a UUIDv4 per checkout session, sends it as
-- `idempotency_key`, server checks for an existing order with that key
-- BEFORE inserting. If one exists, return it (no duplicate). If it
-- doesn't, insert with the key attached and a UNIQUE constraint at the
-- DB layer as a backstop against concurrent scripts.
--
-- Idempotent: safe to re-run. The column is nullable so existing rows
-- are unaffected. PostgreSQL treats NULLs as distinct in UNIQUE indexes,
-- so orders without a key are not blocked by the constraint.

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

-- Backstop: a UNIQUE constraint so two concurrent inserts with the same
-- key from different sessions can't both succeed (the second hits the
-- constraint and the route catches it to re-fetch the winner).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'orders'
      AND indexname = 'orders_idempotency_key_key'
  ) THEN
    ALTER TABLE orders
      ADD CONSTRAINT orders_idempotency_key_key
      UNIQUE (idempotency_key);
  END IF;
END
$$;