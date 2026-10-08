-- 072a: reconcile `payment_events` with the canonical ledger schema.
--
-- Ordering: this file MUST sort before 073_payment_events_ledger.sql.
-- 073 does `CREATE TABLE IF NOT EXISTS payment_events` followed by
-- `CREATE UNIQUE INDEX … (invoice_id, …)`; on a database that still has
-- the legacy table the CREATE is a no-op and the index fails, which
-- halted the whole chain at 072 in production. Running the rename here
-- first lets 073 (and everything after it) apply. On a fresh database
-- the DO block is a no-op and the CREATEs below match 073 exactly.
--
-- Production still has the LEGACY table from migration 007
-- (order_id, event_type, payload, payment_reference). Migration 073
-- (`CREATE TABLE IF NOT EXISTS payment_events …`) therefore never took
-- effect, and every call to recordPaymentEvent()
--   INSERT INTO payment_events (invoice_id, gateway, event_type, raw_payload)
-- fails with `column "invoice_id" does not exist`. That INSERT is the
-- FIRST step of moyasar-confirm / reconcile-payment, so online payments
-- (Moyasar / Tamara) are never marked paid.
--
-- The legacy table is empty in production (verified 2026-09-30), so it
-- is renamed (kept for safety) and the canonical table is created.

BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'payment_events' AND column_name = 'payload'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'payment_events' AND column_name = 'invoice_id'
  ) THEN
    ALTER TABLE payment_events RENAME TO payment_events_legacy_007;
    ALTER INDEX IF EXISTS payment_events_pkey RENAME TO payment_events_legacy_007_pkey;
    ALTER INDEX IF EXISTS idx_payment_events_order RENAME TO idx_payment_events_legacy_order;
    ALTER INDEX IF EXISTS idx_payment_events_type RENAME TO idx_payment_events_legacy_type;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS payment_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id    TEXT NOT NULL,
  gateway       TEXT NOT NULL,
  event_type    TEXT NOT NULL,
  raw_payload   JSONB NOT NULL,
  received_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at  TIMESTAMPTZ,
  order_id      UUID,
  status        TEXT NOT NULL DEFAULT 'received'
    CHECK (status IN ('received', 'processed', 'failed'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_events_invoice_event
  ON payment_events(invoice_id, gateway, event_type);
CREATE INDEX IF NOT EXISTS idx_payment_events_order
  ON payment_events(order_id) WHERE order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payment_events_received_at
  ON payment_events(received_at DESC);
CREATE INDEX IF NOT EXISTS idx_payment_events_unprocessed
  ON payment_events(received_at) WHERE processed_at IS NULL;

-- The role only exists in production; CI / fresh databases use another.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'citymarket_user') THEN
    GRANT ALL ON payment_events TO citymarket_user;
  END IF;
END $$;

COMMIT;
