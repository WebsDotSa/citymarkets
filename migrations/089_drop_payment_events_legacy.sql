-- 089_drop_payment_events_legacy.sql
--
-- AUDIT 2026-09-30 / task 6.1.2: drop the legacy `payment_events_legacy_007`
-- table that was renamed in 072a_payment_events_reconcile.sql.
--
-- Background:
--   Migration 007 created `payment_events` with the schema
--   (order_id, event_type, payload, payment_reference) — the original
--   webhook audit trail. Production never actually wrote to it; every
--   `recordPaymentEvent()` call INSERTed against the canonical schema
--   (invoice_id, gateway, event_type, raw_payload), so the legacy rows
--   stayed NULL. Migration 072a renamed the table to
--   `payment_events_legacy_007` and created the canonical table.
--
-- Verification (2026-09-30):
--   - `grep -rn "payment_events_legacy_007" src/` returns zero hits.
--   - All ledger writes go to `payment_events` (see
--     `src/lib/payments/event-ledger.ts:95`).
--   - Production row count on the legacy table is zero (per
--     072a header comment).
--
-- Safety:
--   The DROP is wrapped in a `IF EXISTS` and `CASCADE` so a re-run is
--   idempotent and removes dependent objects (none exist today, but
--   view definitions or foreign keys could appear after a future
--   schema drift).
--
-- Rollback path:
--   None — once the table is gone, the legacy rows are gone. If a
--   future incident requires the legacy audit trail, restore from
--   the WAL archive (PITR).

BEGIN;

DROP TABLE IF EXISTS payment_events_legacy_007 CASCADE;

COMMIT;