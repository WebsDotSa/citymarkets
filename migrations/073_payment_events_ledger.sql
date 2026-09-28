-- 073 — payment events ledger.
--
-- Why this exists:
--   Per docs/04-PAYMENTS-AND-CHECKOUT.md, every gateway callback MUST be
--   recorded for audit + dispute defense. The current webhook
--   (src/app/api/v1/payments/webhook/route.ts) relies solely on the
--   orders.idempotency_key UNIQUE constraint for replay protection; the
--   constraint catches duplicate order creation but does NOT record the
--   raw provider event, which support needs to triage failed/disputed
--   payments.
--
-- Schema:
--   - invoice_id: provider invoice/payment id (Moyasar `id`, Tamara
--     `order_id`, etc.)
--   - gateway: 'moyasar' | 'tamara' — easy to extend with Stripe later.
--   - event_type: free-form provider event name (e.g. 'payment.paid').
--   - raw_payload: full provider JSON for forensics.
--   - received_at / processed_at: timing for SLO reporting.
--   - order_id: linked order once resolved (NULL until matched).
--   - status: 'received' | 'processed' | 'failed' — the worker's view of
--     how the event was handled.
--
-- Idempotency:
--   uq_payment_events_invoice_event is UNIQUE on (invoice_id, gateway,
--   event_type) so the helper at src/lib/payments/event-ledger.ts can
--   INSERT ... ON CONFLICT semantics without races. INSERTs that
--   collide get a 23505 which the helper converts to a 'duplicate'
--   return value, allowing the webhook to short-circuit with
--   { received: true, duplicate: true }.
--
-- Applied by:
--   `npm run db:migrate` (scripts/migrate.ts), which tracks files via
--   app_migrations. Idempotent thanks to IF NOT EXISTS / IF NOT EXISTS
--   on every object — safe to re-run.

BEGIN;

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
  ON payment_events(order_id)
  WHERE order_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_payment_events_received_at
  ON payment_events(received_at DESC);

CREATE INDEX IF NOT EXISTS idx_payment_events_unprocessed
  ON payment_events(received_at)
  WHERE processed_at IS NULL;

COMMENT ON TABLE payment_events IS
  'Append-only ledger of payment gateway callbacks. Source of truth for dispute defense and audit (docs/04-PAYMENTS-AND-CHECKOUT.md).';

COMMIT;
