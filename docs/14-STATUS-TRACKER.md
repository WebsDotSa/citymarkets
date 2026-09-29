# City Markets — Full-Stack Refactor Status

Updated: 2026-09-29 (reflects `main` HEAD `e7888ec`)

## Phases (per docs/00-FULLSTACK-MASTER-PLAN.md)

| Phase | Title | Status | Evidence |
|---|---|---|---|
| 0 | Freeze + baseline | ✅ Complete | Production DB snapshot, baseline metrics |
| 1 | Audit automation | ✅ Complete | `auth-isolation-audit`, `drift-report` in CI |
| 2 | Foundation | ✅ Complete (partial) | 3 of 5 domain subdirectories (`catalog`, `orders`, `payments`); identity + delivery still flat in `src/lib/` |
| 3 | Database | ⚠️ Code-verified, NOT prod-applied | `073_payment_events_ledger.sql` ready; 17 untracked early migrations (001–017) |
| 4 | Core commerce | ✅ Complete | CheckoutService extracted; route handler 786 → 143 lines |
| 5 | Payments | ✅ Complete (code) | PaymentService + event-ledger + state machine; Moyasar uses recordPaymentEvent, Tamara does not (P2-1) |
| 6 | Operations | ✅ Complete | Order state machine, drivers (069), in-process worker |
| 7 | Frontend | ✅ Complete | Middleware rename (proxy → middleware); JWT verify cache (60s TTL); SEO cache |
| 8 | iOS / contract | ⚠️ v1 frozen, v2 pending | Mobile API v1 retains; v2 contract migration pending |
| 9 | Codemod shims | n/a | No shims on main (Phase 10 reverted) |
| 10 | Domain modules | ⚠️ Partial revert | catalog/orders/payments kept; identity/delivery reverted to flat layout |

## Outstanding P1 (Production prerequisites)

- **P1-1** `073_payment_events_ledger.sql` — code-verified, idempotent, NOT
  yet applied to production DB. Operations must run `npm run db:migrate`
  against production before next webhook traffic. Migration uses
  `CREATE TABLE IF NOT EXISTS` and `CREATE UNIQUE INDEX IF NOT EXISTS` —
  safe to re-run.
- **P1-2** 17 untracked early migrations (001–017) appear in drift report
  because they predate the migration tracker. Schema is already in
  production; only the tracking records are missing. Either retroactively
  register in `app_migrations` OR whitelist in `migration-drift-report.ts`.

## Outstanding P2 (Code work, non-blocking)

- **P2-1** Tamara webhook does not use `recordPaymentEvent` (Moyasar does)
  → small codemod to add `recordPaymentEvent` + `finalizePaymentEvent` to
  `src/app/api/v1/payments/tamara/webhook/route.ts`. Improves dispute
  defense consistency.
- **P2-2** Identity code at `src/lib/` root instead of `src/lib/identity/`
  → optional codemod + barrel extraction. 8 files: `customer-session.ts`,
  `admin-session.ts`, `vendor-auth.ts`, `vendor-session.ts`,
  `admin-api-auth.ts`, `auth-helpers.ts`, `auth-dev.ts`,
  `auth-cookie-name.ts`. Pure refactor.
- **P2-3** Delivery code scattered → optional codemod to extract
  `src/lib/delivery/` bounded context.
- **P2-4** Infrastructure rename — `src/lib/queue/`, `src/lib/r2.ts`,
  `src/lib/logger.ts` could move to `src/infrastructure/`. Low priority.
- **P2-5** Supabase auth fallback in `auth-helpers.ts` (2 routes) —
  migrate OTP flow to JWT-only.

## Outstanding P3 (Cosmetic)

- **P3-1** 126 routes flagged "review" by auth-isolation-audit — no
  direct CSRF call in source. Covered at runtime by `src/middleware.ts`.
  No action.

## Key Metrics (2026-09-29)

- Source files: 126 .ts in `src/lib/` + 152 API routes
- Test files: 141 (vitest)
- Tests passing: 1577 / 1577
- TypeScript errors: 0
- Build: passing
- Domain subdirectories: 3 of 5 (catalog, orders, payments)
- Migrations: 81 (80 applied / 1 pending apply — 073)

## Recent Verification (2026-09-29)

```
npm test              → 1577/1577 in 14s
npx tsc --noEmit      → 0 errors
npm run build         → pass
npm run proxy:guard   → pass
npm run worker:smoke  → pass (3/3)
npx tsx scripts/auth-isolation-audit.ts → 0 gaps
npm run qa:smoke      → pass (all HTTP checks)
npm run qa:critical-paths → 8 passed, 0 failed, 2 skipped (no coupons/offers in test DB)
npm run db:migrate:dry-run → 80 applied / 1 pending (073)
npm run db:drift-report → 17 untracked early migrations (intentional)
```

See `docs/FINAL-PRODUCTION-AUDIT.md` for the full production-readiness review.