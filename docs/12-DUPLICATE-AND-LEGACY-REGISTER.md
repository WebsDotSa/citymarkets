# City Markets — Duplicate & Legacy Register

| Area | Current observation | Canonical target | Retirement condition |
|---|---|---|---|
| Customer auth | JWT/cookie + Supabase fallback | modules/auth | all consumers use actor service |
| DB access | pg + Supabase data client + Drizzle dependency | infrastructure/database | all production paths are repository based |
| Products | products + vendor_products + products_unified history | modules/catalog | canonical model backfilled and parity verified |
| Checkout | large route + large service | modules/checkout | thin route + service tests/E2E |
| Payments | hosted/inline/callback/webhook spread | modules/payments | normalized state/event model |
| Storage | R2 + local paths | infrastructure/storage | all durable uploads on R2 |
| Auth aliases | login/register/signup | app/auth | links/consumers audited |
| Notifications | HTTP fire-and-forget + worker | queue/worker | critical notifications are queued |
| Error logs | filesystem fallback | observability | production does not require app filesystem |
