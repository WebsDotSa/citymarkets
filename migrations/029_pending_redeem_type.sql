-- 029_pending_redeem_type.sql
-- Purpose: add a `pending_redeem` type to loyalty_transactions so we can
--          hold a redemption at order creation time without debiting
--          the balance. The actual debit happens when the payment
--          gateway confirms Paid (in payments/webhook/route.ts).
--
-- Background: previously loyalty was deducted at order creation, which
-- meant a failed online payment left the user short on their balance.
-- We now record the redemption as a hold (`pending_redeem`) and only
-- convert it to a real debit when the gateway callback fires.

DO $t$ BEGIN
  ALTER TYPE loyalty_tx_type_enum ADD VALUE IF NOT EXISTS 'pending_redeem';
EXCEPTION WHEN duplicate_object THEN NULL; END $t$;