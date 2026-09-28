-- Migration: Expand payment/status enums to match production code paths
-- Date: 2026-07-30
--
-- Why:
--   1. The customer payment webhook (src/app/api/v1/payments/webhook/route.ts)
--      writes 'paid' into orders.status on a successful payment, but the
--      order_status_enum created in 001_full_schema.sql only includes
--      ('pending','confirmed','shopping','on_the_way','delivered','cancelled').
--      Every paid customer order would crash with an enum constraint error.
--   2. vendor_orders.payment_method CHECK only allows legacy methods
--      ('moyasar_card','moyasar_applepay','cod') even though the checkout
--      sends 'mada','visa','mastercard','stc_pay' from the same Moyasar
--      integration. New vendor payments would be rejected at the DB.
--
-- Both changes are idempotent and safe to re-run.

-- ============================================
-- 1. Add 'paid' to order_status_enum
-- ============================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON e.enumtypid = t.oid
    WHERE t.typname = 'order_status_enum'
      AND e.enumlabel = 'paid'
  ) THEN
    ALTER TYPE order_status_enum ADD VALUE 'paid';
  END IF;
END
$$;

-- ============================================
-- 2. Expand vendor_orders.payment_method CHECK
-- ============================================
ALTER TABLE vendor_orders
  DROP CONSTRAINT IF EXISTS vendor_orders_payment_method_check;

ALTER TABLE vendor_orders
  ADD CONSTRAINT vendor_orders_payment_method_check
  CHECK (payment_method IN (
    -- Legacy values (kept for back-compat with old orders)
    'moyasar_card',
    'moyasar_applepay',
    'cod',
    -- Modern Moyasar payment methods (Moyasar PaymentMethods API)
    'card',
    'mada',
    'visa',
    'mastercard',
    'amex',
    'applepay',
    'stcpay',
    -- Catch-all free-text for provider-specific values
    'other'
  ));