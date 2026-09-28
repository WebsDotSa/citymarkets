# City Markets — Payments & Checkout

## Target flow
```
Client
  -> Checkout API
  -> Checkout Service
  -> Cart / Inventory / Pricing
  -> Order
  -> Payment Intent / Attempt
  -> Provider Adapter
  -> Moyasar or Tamara
  -> Webhook
  -> Payment Webhook Processor
  -> Payment State Machine
  -> Order State Machine
```

## Rules
1. Never trust client prices/totals.
2. Redirect/success query parameters are never proof of payment.
3. Verify provider amount and currency.
4. Webhooks are authenticated and idempotent.
5. Persist provider event IDs.
6. Payment creation is idempotent.
7. Failed provider setup cannot leave ambiguous state.
8. Refunds are explicit.
9. Use actual order lines where supported.

## Recovery
- duplicate checkout => same order
- duplicate webhook => no-op
- provider paid + order pending => reconcile
- amount mismatch => do not mark paid; create operational alert
