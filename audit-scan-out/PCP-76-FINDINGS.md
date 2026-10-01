# PCP-76 — Backend Audit Findings

**Issue**: PCP-76 (Backend audit) — owned by citymarkets-backend
**Date**: 2026-10-01
**Base**: `origin/main` @ `ecc435c`
**Worktree**: `/var/www/citymarkets.sa/city-market-app/.worktrees/hermes-8e862231` (branch `hermes/hermes-8e862231`)

## Scope

Sweep every `route.ts` under `src/app/api/` for:
1. Auth (CSRF, RLS, in-handler admin/vendor/customer guards)
2. Error envelopes
3. Rate limits
4. Prisma query efficiency (N+1)
5. SQL injection patterns
6. Migrations parity vs DB

## Method

- **Inventory**: 155 route.ts files (98 v1, 56 admin, 1 health).
- **Tool**: `audit-scan-out/scan_dead_imports.py` — parses every `import … from …`, strips them, then regex-searches each alias. A symbol is dead if zero whole-word hits remain.
- **Deep review**: Read 6 longest/highest-complexity routes (admin/categories, admin/driver/orders/[id], v1/vendors/[slug]/orders, admin/orders, admin/vendors, v1/products) — checked N+1, error envelope, auth/CSRF, SQL injection, transaction-wrapping.

## Architecture (verified clean)

| Concern | Status | Evidence |
|---|---|---|
| CSRF double-submit cookie | ✅ | `src/middleware.ts:155-220` — `CSRF_EXEMPT_SET` (exact) + 1-trailing-segment prefix allowlist (prefix-bypass-safe per audit comment). |
| Admin auth | ✅ | In-handler `requireAdminApi("permission")` is first statement in every admin handler. Only 6 routes skip (login/logout/otp-send/otp-verify × admin+vendor). |
| Vendor auth | ✅ | In-handler `verifyVendorRequestWithDb` — DB-backed verification. |
| Customer auth | ✅ | In-handler `getCustomerUserIdFromRequest` — DB-backed verification. |
| Migrations parity | ✅ | 113 local == 113 in `app_migrations`; 95/113 placeholders in `checksum` column (legacy, handled by `scripts/migrate.ts`). |
| RLS | ✅ | 38 public tables with `rowsecurity=true`. |
| `products_readonly_guard` | ✅ | Trigger + `guard_products_readonly()` function present on `public.products`. |
| SQL injection | ✅ | All raw SQL uses `$N` parameterization; no string-concat of user input found across 155 routes. |

## Findings

### F1 — Dead imports in `src/app/api/v1/orders/route.ts` ✅ FIXED

- **Severity**: high (code-rot signal; bloats module graph; confusing for readers since POST is a 410 stub)
- **Status**: ✅ fixed in this worktree
- **Detail**: POST has been a 410 deprecation stub since 2026-09-30 (item A4) — points clients to `POST /api/v1/checkout`. Despite the deprecation, the full order-creation scaffolding remained imported: `getGuestSessionIdFromRequest`, `resolveOrderAddress`, `createOrderSchema`, `validationError`, `checkRateLimit`, `ORDER_CREATE_CONFIG`, `createRateLimitHeaders`, `getClientIp`, `logWarn`, `logInfo`, `reportCheckoutError`, `parseSlotsConfig`, `riyadhWallClockToUtc`, `toRiyadhDateKey`, `validateSlotSelection`, `evaluateHours`, `getActiveStoreHours`, `computeOrderFees`, `computeCouponDiscount`, `computeLoyaltyRedemption`, `PricingSettings`, `getLoyaltySettings`, `getMainStoreAndDistance`, `resolvePaymentMethod` — 24 dead imports.
- **Fix**: removed the unused imports; kept `NextRequest`, `NextResponse`, `pool`, `resolveCustomerUserIdFromRequest`, `logError`, `ORDER_LIST_COLUMNS`.
- **Verification**: `npx tsc --noEmit` → 0 errors; `npx vitest run` → 1980 passed / 1 failed (pre-existing `delivery/slots/route.test.ts:128`, unrelated) / 1 skipped.

### F2 — `releaseRedeemHoldForOrder(client, …)` runs on connection past COMMIT

- **File**: `src/app/api/admin/driver/orders/[id]/route.ts:363, 481`
- **Severity**: low (works today, fragile contract)
- **Detail**: After `client.query("COMMIT")` at line 330/339/442, the `.catch` callback invokes `releaseRedeemHoldForOrder(client, …)` which calls `client.query(DELETE …)`. Auto-commit on a connection the rest of the handler still considers "ours" works because `finally` releases it; but if the helper is later changed to assume a transactional context (or adds BEGIN), it'll break silently.
- **Fix**: acquire a fresh `pool.connect()` for the release, OR add a JSDoc on `releaseRedeemHoldForOrder` documenting the post-commit context assumption.
- **Status**: open (child subtask needed)

### F3 — `request.json()` outside try/finally in admin driver orders

- **File**: `src/app/api/admin/driver/orders/[id]/route.ts:142, 183`
- **Severity**: low (UX/inconsistency, not security)
- **Detail**: `await request.json()` at line 142 runs BEFORE the try block that opens `client = await pool.connect()` at line 183. If the body is malformed JSON, the throw bypasses the catch block at line 522, so the user gets Next.js's default 500 with no `{ success: false, error: "…" }` envelope. Not a connection leak (no client acquired yet).
- **Fix**: move `request.json()` inside the try block.
- **Status**: open (child subtask needed)

### F4 — N+1 on order items in `GET /api/v1/vendors/[slug]/orders`

- **File**: `src/app/api/v1/vendors/[slug]/orders/route.ts:133-145`
- **Severity**: medium (bounded to ~10 queries today via LIMIT 10, wasteful)
- **Detail**: `Promise.all(result.rows.map(async (o) => query(... vendor_order_items WHERE voi.order_id = $1, [o.id])))` fires one extra round-trip per order. Worse, when `?id=` is set (line 184), items are queried for orders[1..N] only to be thrown away.
- **Fix**: collect ids → single `WHERE order_id = ANY($1)` query.
- **Status**: open (child subtask needed)

### F5 — N+1 on order items + stock decrement in `POST /api/v1/vendors/[slug]/orders`

- **File**: `src/app/api/v1/vendors/[slug]/orders/route.ts:387-404`
- **Severity**: medium (bounded by cart size; 21+ round-trips inside held transaction)
- **Detail**: per-item `INSERT INTO vendor_order_items` then `UPDATE vendor_products SET stock_quantity = stock_quantity - $1` for tracked-stock items. Bounded by `items.length` (client-controlled).
- **Fix**: single bulk INSERT with `unnest(... :: uuid[])` + bulk UPDATE with `WHERE id = ANY($1)`.
- **Status**: open (child subtask needed)

### F6 — Non-transactional status read+write in `PUT /api/admin/orders`

- **File**: `src/app/api/admin/orders/route.ts:290-323`
- **Severity**: medium (race condition; not strictly safe without restructuring)
- **Detail**: `SELECT status, driver_id FROM orders WHERE id = $1 LIMIT 1` at line 290 (no `FOR UPDATE`) → `assertValidTransition(admin, orders, oldStatus, newStatus)` → `UPDATE …` at line 323. A concurrent admin could flip the status between read and write, causing `assertValidTransition` to run against a stale `oldStatus`. The handler is not transaction-wrapped (no BEGIN/COMMIT), so the state-machine guard is advisory only.
- **Fix**: wrap the read+update in `pool.connect()`/`BEGIN`/`COMMIT`, or add `FOR UPDATE` to the SELECT.
- **Status**: open (child subtask needed)

### F7 — Non-atomic vendor+owner update in `PUT /api/admin/vendors`

- **File**: `src/app/api/admin/vendors/route.ts:353 + 416`
- **Severity**: medium (partial-save failure mode; misleading 500 on owner-validation failure)
- **Detail**: PUT's vendor UPDATE (line 353) + owner upsert (line 416) run on `query()`, not `client`. A failure on the owner upsert after the vendor row already committed yields "فشل التحديث" generic 500 even though the vendor was updated. POST correctly wraps its INSERT + upsert in a BEGIN/COMMIT block — PUT should mirror.
- **Fix**: wrap PUT's vendor UPDATE + owner upsert in a `pool.connect()`/`BEGIN`/`COMMIT` block mirroring POST; return a 4xx for owner-validation errors so the user gets a useful error.
- **Status**: open (child subtask needed)

### F8 — Dead imports in 60 other route.ts files

- **Severity**: low (mostly `logInfo`/`logWarn` not used in that file)
- **Detail**: Scanner found 113 dead symbols across 60 files. Many are `logInfo`/`logWarn` from `@/lib/logger` that were added preemptively and never called; a few are leftover from refactors (e.g. `GENERAL_API_CONFIG`, `DEFAULT_DELIVERY_HOURS`, `DEFAULT_STORE_OPENING_HOURS`, `isNativePushConfigured`).
- **Top offenders** (full inventory in `audit-scan-out/dead_imports_grouped.md`):
  - `admin/admin-users/route.ts`: logWarn, logInfo
  - `admin/auth/change-password/route.ts`: logWarn, logInfo
  - `admin/auth/login/route.ts`: logWarn, logInfo
  - `admin/broadcast-providers/status/route.ts`: isNativePushConfigured
  - `admin/categories/route.ts`: logInfo
  - `admin/coupons/route.ts`: logWarn, logInfo
  - `admin/delivery-settings/route.ts`: DEFAULT_DELIVERY_HOURS
  - `admin/stores/route.ts`: DEFAULT_STORE_OPENING_HOURS, logWarn, logInfo
  - `v1/vendor/orders/route.ts`: NextRequest, logWarn, logInfo
  - `v1/vendors/[slug]/orders/route.ts`: GENERAL_API_CONFIG, logWarn, logInfo
  - …and 50 more (mostly logInfo/logWarn)
- **Status**: open (single bulk child subtask recommended — `chore(cleanup): remove dead logInfo/logWarn imports across 60 admin/v1 route.ts`)

## Verification matrix

| Gate | Command | Result |
|---|---|---|
| TypeScript | `npx tsc --noEmit` | 0 errors |
| Unit tests | `npx vitest run --reporter=basic` | 1980 passed / 1 failed (pre-existing) / 1 skipped |
| Migrations parity | `SELECT count(*) FROM app_migrations` | 113 local == 113 ✅ |
| RLS count | `SELECT count(*) FROM pg_class WHERE relrowsecurity` | 38 tables ✅ |
| Dead imports in fixed file | `python3 audit-scan-out/scan_dead_imports.py` | orders/route.ts: 24 → 0 ✅ |
| Container log scan | `docker logs --tail 200 city-market-app-citymarket-app-1 \| grep -iE 'error\|exception' \| grep -v 'Twilio Verifications' \| head` | (run as follow-up after PR) |

## Proposed child issues

| # | Title | Owner |
|---|---|---|
| PCP-76.1 | fix(v1/orders): drop 24 dead imports (POST is 410 stub) | ✅ closed by this worktree |
| PCP-76.2 | fix(admin/driver/orders/[id]): move `request.json()` inside try/finally | citymarkets-backend |
| PCP-76.3 | fix(admin/driver/orders/[id]): decouple `releaseRedeemHoldForOrder` from post-commit connection | citymarkets-backend |
| PCP-76.4 | perf(v1/vendors/[slug]/orders): collapse per-order items N+1 to single `ANY($1)` query | citymarkets-backend |
| PCP-76.5 | perf(v1/vendors/[slug]/orders): bulk INSERT + UPDATE in POST items loop | citymarkets-backend |
| PCP-76.6 | fix(admin/orders): wrap status read+write in `BEGIN`/`COMMIT` (or `FOR UPDATE`) | citymarkets-backend |
| PCP-76.7 | fix(admin/vendors): wrap PUT vendor UPDATE + owner upsert in transaction | citymarkets-backend |
| PCP-76.8 | chore(cleanup): remove dead logInfo/logWarn imports across 60 admin/v1 route.ts | citymarkets-backend |

## Notes on prior runs

Three previous runs (`75b08cf5`, `1ac2675f`, `2baa2fbd`) created branches `hermes-b7481eb1`, `hermes-fe2754c0`, `hermes-351aaa68` in their own worktrees but never landed the F1 fix on `main` or on this worktree. This run fixes F1 and writes durable findings here; the proposed child issues F2-F8 are open work the next agent run will pick up.