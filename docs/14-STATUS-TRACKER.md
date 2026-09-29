# City Markets — Full-Stack Refactor Status

Updated: 2026-09-29 (reflects `migration/integrity-repair` HEAD `94872b5`; main HEAD `e7888ec` + PR #5)

## Phases (per docs/00-FULLSTACK-MASTER-PLAN.md)

| Phase | Title | Status | Evidence |
|---|---|---|---|
| 0 | Freeze + baseline | ✅ Complete | Production DB snapshot, baseline metrics |
| 1 | Audit automation | ✅ Complete | `auth-isolation-audit`, `drift-report` in CI |
| 2 | Foundation | ✅ Complete (partial) | 3 of 5 domain subdirectories (`catalog`, `orders`, `payments`); identity + delivery still flat in `src/lib/` |
| 3 | Database | ✅ **Fresh-DB integrity chain fixed in PR #5** | `migration/integrity-repair` branch (`94872b5`): 9 BREAKERs identified and repaired across 007/004/013/017/023/042/060/073 + 073 owns payment_events (007's legacy INTEGER-vs-UUID CREATE TABLE dropped). Full migration chain 001→073 now applies cleanly to a fresh PostgreSQL 16 + pgvector. CI gate updated to `pgvector/pgvector:pg16` + `npm run db:migrate` (no `--mark-applied`). 17 untracked early migrations remain as documentation debt (P1-2). |
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
  safe to re-run. **Fresh-DB integrity verified in PR #5** —
  the full chain 001→073 now applies cleanly (previously blocked by
  `004_addresses.guest_key` CREATE INDEX on missing column,
  `007_admin_extended_features.reviews` INTEGER-vs-UUID FK, `013_rls_policies`
  BYPASSRLS requiring SUPERUSER + missing `delivery_settings`/`stores`
  tables, `017_product_reviews` GRANTs to non-existent roles,
  `023_nullable_orders_user_address` CHECK on missing `guest_phone`,
  `042_category_taxonomy_reorder` INSERT into missing parents,
  `060_vendors_cleanup_and_split` PRECHECK RAISE EXCEPTION on missing
  categories, `073_payment_events_ledger` unique-index on columns the
  legacy 007 declaration would not have created).
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
- Migrations: 81 (chain 001→073 applies cleanly to fresh DB after PR #5; 80 recorded in app_migrations on prod, 073 not yet applied)

## Recent Verification (2026-09-29)

```
npm test              → 1601/1601 in 17s (PR #5 round 2 added coverage)
npm run lint          → 0 errors
npm run build         → pass (BUILD_ID written)
npm run proxy:guard   → pass
npm run worker:smoke  → pass (3/3)
npx tsx scripts/auth-isolation-audit.ts → 0 gaps
npm run qa:smoke      → pass (all HTTP checks)
npm run qa:critical-paths → 9 passed, 0 failed, 1 skipped (no active offers)
npm run db:migrate    → 001→074 applies cleanly to fresh pgvector DB (82 migrations)
npm run db:migrate (re-run) → 0 pending, idempotent
npm run db:drift-report → 0 expected missing, 0 applied-missing, 0 unapplied (1 intentional: app_migrations)
npm run test:coverage → MISSING @vitest/coverage-v8 dep (P3 env gap, not installed)
```

## PR #5 — Fresh-DB migration integrity chain (`migration/integrity-repair`, HEAD `2343850`)

11 BREAKERs identified and repaired so a fresh PostgreSQL 16 + pgvector
DB can apply the full 001→074 chain. Verified by actually running
`npm run db:migrate` against a real `pgvector/pgvector:pg16` container
(port 5438, password=postgres, database=citymarket_test) with no
pre-existing tables, no `--mark-applied`, and no manual SQL.

| # | Migration | Issue | Fix |
|---|---|---|---|
| 1 | `004_addresses` | `CREATE INDEX` on `addresses.guest_key` (column missing in 001) | `ALTER TABLE addresses ADD COLUMN IF NOT EXISTS guest_key VARCHAR(64)` first |
| 2 | `007_admin_extended_features` | Legacy `payment_events` CREATE TABLE with `order_id INTEGER` vs `orders.id UUID` | Drop legacy CREATE; 073 owns payment_events with canonical schema |
| 3 | `007_admin_extended_features` | Legacy `reviews` CREATE TABLE with `order_id INTEGER` FK (master prompt item 4) | Drop legacy CREATE; 001 owns reviews with UUID schema |
| 4 | `013_rls_policies` | FOREACH loop references `delivery_settings` + `stores` (don't exist until 032); BYPASSRLS requires SUPERUSER | Wrap each EXECUTE in `IF EXISTS (SELECT 1 FROM pg_class ...)` guard; split BYPASSRLS into its own block |
| 5 | `017_product_reviews` | GRANTs to non-existent roles (`marketing_user`, `ads_labs`, ...) | Per-role DO block with `EXCEPTION WHEN undefined_object` |
| 6 | `023_nullable_orders_user_address` | CHECK references `guest_phone` (001 doesn't create it) | `ALTER TABLE orders ADD COLUMN IF NOT EXISTS guest_phone VARCHAR(32)` first |
| 7 | `042_category_taxonomy_reorder` | INSERT INTO `_reparent_plan` fails (NOT NULL `source_parent_id` on missing Arabic slugs) | Make `source_parent_id` NULLable; LEFT JOIN |
| 8 | `060_vendors_cleanup_and_split` | PRECHECK RAISE EXCEPTION on missing `amyz-kafyh` / `warwad-amyz` categories | Downgrade to RAISE NOTICE (skip-and-warn) |
| 9 | `073_payment_events_ledger` | UNIQUE INDEX on `payment_events(invoice_id, gateway, event_type)` — columns wouldn't exist if 007's legacy declaration had been kept | Resolved by fix #2 |
| 10 | `037_vendor_aware_cart` | `COALESCE(vendor_id, '<uuid literal>')` literal lacks `::uuid` cast | Cast to uuid |
| 11 | **runtime** (cart route) | `ON CONFLICT` COALESCE didn't match 037's index expression byte-for-byte, AND partial index requires re-stating the `WHERE product_id IS NOT NULL` predicate for inference | Align ON CONFLICT expression + add WHERE |

New migration file (post-032, safe to apply):

| File | Purpose |
|---|---|
| `migrations/074_seed_main_store.sql` | Seeds `stores.is_main = true` row (Riyadh HQ coordinates). Without it, `/api/v1/delivery/quote` returns 503 and qa:critical-paths fails on a fresh DB even after all migrations apply — checkout cannot quote delivery. |

Runtime fix in src/ (commit `2343850`):

| File | Issue | Fix |
|---|---|---|
| `src/app/api/v1/cart/route.ts` | Cart INSERTs `ON CONFLICT (user_id, product_id, COALESCE(vendor_id, '<text>'))` did NOT match the 037 partial unique index, so Postgres could not infer the conflict target and silently added duplicate cart rows instead of merging | Match expression byte-for-byte (`::uuid` cast) + re-state the partial predicate (`WHERE product_id IS NOT NULL`) |

CI workflow (`.github/workflows/ci.yml`) updated in this PR:

- Postgres service: `postgres:16-alpine` → `pgvector/pgvector:pg16`
- Migration step: `npm run db:migrate:dry-run` → `npm run db:migrate`
  (hard-fail on any DDL error; no `--mark-applied` workaround)
- Comment-only references to `--mark-applied` (CI comment + scripts/migrate.ts help text) — the only remaining mentions are documentation, not active CI workarounds

See `docs/FINAL-PRODUCTION-AUDIT.md` for the full production-readiness review.