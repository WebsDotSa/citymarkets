-- 028_payment_reference_unique.sql
-- Purpose: enforce one payment_reference → one order. The MyFatoorah
--          invoice id is unique per payment, so any duplication at the
--          DB level indicates either a stale retry (caught by the
--          idempotency check in the webhook) or a hand-rolled duplicate
--          that we want to surface loudly instead of silently
--          double-crediting loyalty / sending duplicate push notifications.
--
-- Why a partial UNIQUE index: payment_reference is nullable for COD
-- orders where no gateway invoice exists yet. A full UNIQUE on the
-- column would force every COD row to have a unique placeholder value.
-- Partial UNIQUE on `WHERE payment_reference IS NOT NULL` keeps the
-- constraint scoped to gateway payments only.

CREATE UNIQUE INDEX IF NOT EXISTS uniq_orders_payment_reference_active
  ON orders (payment_reference)
  WHERE payment_reference IS NOT NULL;