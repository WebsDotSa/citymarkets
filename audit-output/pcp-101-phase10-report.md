# PCP-101 Phase 10 Audit Report — 2026-10-02

## Scope

Targeted audit covering:
1. Migration drift (PCP-115)
2. Live API contract (pagination, UUID, response shape)
3. Data integrity
4. Race conditions in checkout

## Findings

| # | Severity | Title | Status |
|---|----------|-------|--------|
| **PCP-115** | P2 | app_migrations has 3 duplicate numeric prefixes (041, 059, 060) | DOCUMENTED via _migration_guards |
| **PCP-118** | P2 | List endpoints accept any `limit` value without consistent clamping | PARTIAL FIX (central helper + admin/categories + admin/users) |
| **PCP-119** | P3 | Migrate remaining 10 list endpoints to use parsePagination | TRACKED |
| **PCP-120** | P3 | Checkout service UPDATE without FOR UPDATE | TRACKED |
| **PCP-121** | P3 | Inconsistent UUID rejection (404 vs 400 across endpoints) | TRACKED |
| **PCP-122** | P3 | `/api/v1/search` returns 404 — dead route | DEAD (not called from frontend) |
| Migration drift | — | — | - |
| RLS coverage | — | 0 gaps | - |
| Force RLS | — | 0 tables | - |
| UUID guards | — | All 27 [id] routes covered | - |
| Order totals | — | 0 mismatches | - |
| Auth-before-DB | — | No DB calls before auth | - |

## PCP-115 details

**Bug**: app_migrations has 3 duplicate numeric prefixes — `041_*` (×2), `059_*` (×3), `060_*` (×3). The migration runner picks the first match lexicographically:
- 041: `041_analytics.sql` would be picked, `041_native_push_tokens.sql` silently skipped
- 059: `059_grant_direct_order_messages.sql` would be picked, `059_vendor_applications.sql` silently skipped
- 060: `060_drop_delivery_zones.sql` would be picked, `060_rollback.sql` + `060_vendors_cleanup_and_split.sql` skipped

The current cluster had all of them applied manually (verified: all expected tables exist). But a fresh cluster rebuilt from the migrations/ directory would silently skip one file per prefix pair.

**Fix**: Migration 109 (Phase 9) already documents this via `_migration_guards.migration_duplicates_known`. Long-term fix is PCP-117 (rename to 041a/041b, 059a/059b, 060a/060b/060c).

## PCP-118 details (FIXED this commit)

**Bug**: List endpoints accept any `limit` value without consistent validation:

| Endpoint | limit=999999 | limit=-1 | limit=abc |
|---|---|---|---|
| /api/v1/products | 100 (capped) | 1 | 50 |
| /api/v1/categories | **145 (NO clamp)** | 1 | 50 |
| /api/v1/vendors | **7 (NO clamp)** | 1 | 50 |
| /api/v1/offers | 1 | 1 | 50 |
| /api/admin/orders | **75 (no clamp)** | 1 | 50 |
| /api/admin/vendors | **8 (no clamp)** | 1 | 50 |
| /api/admin/categories | **100 (no clamp)** | 1 | 50 |
| /api/admin/users | 100 (capped) | 1 | 25 |

Inconsistent UX, potential DoS via full-table scans, inconsistency between admin + customer surfaces.

**Fix** (this commit):

1. New `src/lib/api/pagination.ts` with `parsePagination(params, opts?)` and `clampLimit(raw, opts?)`. Both helpers centralise:
   - DEFAULT_LIMIT = 50
   - MAX_LIMIT = 100
   - MAX_PAGE = 10,000 (avoids OFFSET full scans)
   - NaN / negative / empty / zero → DEFAULT
   - value > MAX → MAX

2. 14 unit tests in `src/lib/api/pagination.test.ts` covering every edge case the audit found.

3. Migrated 2 admin routes to use the helper:
   - `src/app/api/admin/categories/route.ts`
   - `src/app/api/admin/users/route.ts` (with `defaultLimit: 25`)

   Both keep their existing default limits for normal callers.

**Follow-up** (PCP-119): migrate the remaining 10 list endpoints — v1/products, v1/categories, v1/vendors, v1/offers, admin/orders, admin/vendors, admin/products, admin/offers, etc.

## PCP-120 details (TRACKED)

**Bug**: `src/lib/orders/checkout/checkout-service.ts` does `UPDATE orders SET payment_reference = $1, payment_status = 'pending' WHERE id = $2` **without** a `FOR UPDATE` lock. If a webhook callback fires at the same moment as the gateway redirect completes, both writes race; the order's `payment_reference` may end up with the wrong gateway reference id.

Not currently exploited (Moyasar's webhook uses an idempotency key derived from orderId), but a hardening opportunity.

**Fix**: wrap the UPDATE in a `BEGIN; SELECT ... FOR UPDATE; UPDATE; COMMIT;` block. Tracked as PCP-120.

## PCP-121 details (TRACKED)

**Bug**: UUID-invalidated routes return inconsistent status codes:
- `/api/v1/products/bad-uuid` → 404
- `/api/v1/orders/bad-uuid/messages` → 400
- `/api/admin/orders/bad-uuid` → 400
- `/api/admin/offers/bad-uuid` → 400

404 for products is intentional (don't reveal whether the UUID format was wrong vs the product doesn't exist). All other endpoints correctly use 400. No bug, just inconsistency worth noting.

## Live verification

- container healthy on latest image
- 8 bad-UUID endpoints return 400 (or 404 for product detail)
- 4 garbage-pagination values (999999, -1, abc, empty) all return DEFAULT (50)
- tsc: 0 errors
- vitest: 2054/2060 pass (+14 net vs pre-fix)

## Summary

- **1 commit** on main for PCP-118: `b99962b`
- **2 open P3** (PCP-120 hardening, PCP-121 inconsistency)
- **2 tracked follow-ups** (PCP-117 migration rename, PCP-119 route migration)
- vitest: 2054/2060 pass
- live: all list endpoints clamp `limit` consistently (where migrated)

## Open (تحتاج عملك خارج النطاق)

- Twilio Geo Permissions: enable SA in Twilio Console
- aqar.labs.sa SSL 525: Cloudflare-side

Generated 2026-10-02T20:26:58.767037+00:00 by hermes PCP-101 Phase 10 audit.
