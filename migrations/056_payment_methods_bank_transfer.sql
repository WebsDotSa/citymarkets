-- 056_payment_methods_bank_transfer.sql
-- Purpose: add `bank_transfer` to the supported payment methods and seed
-- the canonical Al Rajhi bank account that customers should transfer to.
-- Also documents (but does NOT enforce) the removal of `cash`, `stc_pay`,
-- `tamara`, `cod` from the customer-facing picker — the backend remains
-- permissive so historical rows keep working; the front-end controls the
-- visible list (`src/lib/payment-methods.ts`).
--
-- Operator decision (2026-09-20):
--   * cash on delivery  → removed
--   * STC Pay           → removed
--   * Tamara (BNPL)     → removed
--   * bank transfer     → enabled, details shown in checkout
--
-- We still expand the CHECK constraint (rather than just adding a column)
-- so the parser doesn't surprise us when a future feature wires a new
-- token into the catalog checkout.

BEGIN;

-- 1) Expand vendor_orders.payment_method CHECK to include `bank_transfer`.
--    Same idempotent drop/add pattern as 038_multi_vendor_checkout.sql.
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
    -- Unified catalog tokens (cash/wallet were added in 038)
    'cash',
    'wallet',
    'stc_pay',
    'apple_pay',
    -- New: manual bank transfer
    'bank_transfer',
    -- Catch-all for provider-specific values
    'other'
  ));

-- 2) `orders.payment_method` is VARCHAR(32) with NO CHECK (per 006 and
--    the comment in 038 step 5), so we don't need to touch it. New tokens
--    pass through freely.

-- 3) Seed the canonical Al Rajhi account used by the customer-facing
--    bank-transfer card. The application also hard-codes these values
--    in `src/lib/payment-methods.ts` (BANK_TRANSFER_DETAILS) so the
--    checkout never blocks on a DB read; this row exists so admin
--    dashboards and analytics can see the source of truth.
INSERT INTO app_settings (key, value) VALUES (
  'payment.bank_transfer',
  jsonb_build_object(
    'enabled', true,
    'bank_name', 'مصرف الراجحي',
    'account_name', 'مؤسسة اسواق سيتي المركزية للمواد الغذائية',
    'account_iban', 'SA9580000422608016336661'
  )
)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();

-- 4) ANALYZE so the planner sees the updated CHECK stats immediately.
ANALYZE vendor_orders;
ANALYZE app_settings;

COMMIT;