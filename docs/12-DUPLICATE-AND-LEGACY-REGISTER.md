# City Markets — Duplicate & Legacy Register

> This table records the *target* architecture per area. The **current** canonical
> owner of each responsibility is in [`architecture/canonical-sources.md`](architecture/canonical-sources.md);
> the latest classified findings are in [`audits/2026-09-30-duplication-audit.md`](audits/2026-09-30-duplication-audit.md).
> Run `npm run dup:scan` for a live report.

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
