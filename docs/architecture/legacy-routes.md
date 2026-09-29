# Legacy routes

> **Last updated**: 2026-09-30 — `refactor/full-repository-consolidation` branch

This document classifies every legacy / deprecated route and migration
path. Each entry tags itself with one of:

- **CANONICAL** — single source of truth, no plan to remove.
- **COMPATIBILITY** — kept for in-flight clients; not the
  recommended path; the canonical alternative is documented.
- **DEPRECATED** — `410 Gone` or `@deprecated` JSDoc; the canonical
  alternative is documented; safe to remove once clients migrate.
- **DELETE** — confirmed zero consumers; safe to delete in next
  consolidation pass.

## Routes

### `POST /api/v1/orders` — DEPRECATED

| | |
|---|---|
| File | `src/app/api/v1/orders/route.ts:187-979` (793 lines) |
| Status | DEPRECATED |
| Canonical alternative | `POST /api/v1/checkout` (unified multi-vendor checkout) |
| Reason for keeping | Hidden consumers not fully inventoried; iOS / 3rd-party callers may still POST here |
| Plan | Add `@deprecated` JSDoc. If authenticated user POSTs, return 400 with `{ error: "Use POST /api/v1/checkout", redirect: "/api/v1/checkout" }`. Confirm after 1 quarter of 400s, then mark for deletion. |

### `POST /api/v1/orders/direct` — CANONICAL

| | |
|---|---|
| File | `src/app/api/v1/orders/direct/route.ts` |
| Status | CANONICAL |
| Used by | `src/app/orders/direct/page.tsx:187` (customer free-text direct orders) |
| Audit notes | One of the few routes that still inlines address creation SQL — B6 migration target. |

### `POST /api/v1/checkout` — CANONICAL

| | |
|---|---|
| File | `src/app/api/v1/checkout/route.ts:24` |
| Status | CANONICAL |
| Audit notes | Slice 3 unified multi-vendor checkout. Single source of checkout truth. |

### `POST /api/v1/payments/initiate` + `POST /api/v1/payments/retry` + `GET /api/v1/payments/status` — CANONICAL

| | |
|---|---|
| Files | `src/app/api/v1/payments/{initiate,retry,status}/route.ts` |
| Status | CANONICAL |
| Audit notes | All three routes share the 9-step pipeline extracted into `payment-service.ts` (Phase 6). Discriminated-union result shape (`{ kind: "ok" } | "rate_limited" | ...`) means each route is ~50 lines instead of 200. |

### `POST /api/v1/payments/webhook` — CANONICAL (Moyasar)

| | |
|---|---|
| File | `src/app/api/v1/payments/webhook/route.ts` |
| Status | CANONICAL |
| Audit notes | Post-COMMIT vendor fan-out (P0-2 closed earlier); customer SMS also fires post-COMMIT (W1 closed in this branch). |

### `POST /api/v1/payments/tamara/webhook` — CANONICAL

| | |
|---|---|
| File | `src/app/api/v1/payments/tamara/webhook/route.ts` |
| Status | CANONICAL |
| Audit notes | W2 audit finding was a false positive — Tamara webhook already had post-COMMIT vendor fan-out (lines 357-362). Same `loadOrderVendorIds` loader as Moyasar. |

### `POST /api/v1/delivery/quote` — CANONICAL

| | |
|---|---|
| File | `src/app/api/v1/delivery/quote/route.ts` |
| Status | CANONICAL |
| Audit notes | One inline main-store SELECT remains (H7 audit) — F migration target. |

## Module-level legacy

### `src/lib/supabase/database.types.ts` — DELETE (pre-existing)

Deleted in commit `16e822a` (Phase A1). Was a placeholder, zero
importers.

### `src/lib/auth/{jwt-helper,jwt-verify-cache,role-cache}.ts` — DELETE (pre-existing)

Deleted in commit `16e822a`. Deprecated re-exports of
`src/lib/identity/auth/*`.

### `src/lib/categories/tree.ts`, `src/lib/seo/{sitemap-sources,product}.ts`,
### `src/lib/ai-chat-client-types.ts`, `src/lib/vendor-types.ts` — DELETE (pre-existing)

Deleted in commit `16e822a`. Deprecated re-exports of
`src/lib/catalog/*` modules.

### `src/lib/payments/index.ts` — DELETE (pre-existing)

Deleted in commit `16e822a`. Public barrel with zero importers and
a `pg`-importing re-export that wasn't covered by the server-only
carve-out.

### `src/components/admin/admin-notifications-settings.tsx` — DELETE (pre-existing)

Deleted in commit `4d64ec9`. Zero importers; admin route handled
notifications inline.

### `src/components/storefront/category-tile.tsx` — DELETE (pre-existing)

Deleted in commit `4d64ec9`. Zero importers.

### `src/components/ui/trust-badges.tsx` — DELETE (pre-existing)

Deleted in commit `4d64ec9`. Zero importers.

### `src/components/ui/admin/badge.tsx` — DELETE (pre-existing)

Deleted in commit `4d64ec9`. Zero importers.

### `src/components/orders/invoice-pdf.tsx` — DELETE (pre-existing)

Deleted in commit `4d64ec9`. Server-side render at
`src/server/invoice-pdf-server.tsx` is the canonical path.

### `src/components/pages/home/home-v2.tsx` — DELETE (pre-existing)

Deleted in commit `4d64ec9`. Structural contract retired.

### `src/hooks/useAnalytics.ts` — DELETE (pre-existing)

Deleted in commit `4d64ec9`. Callers migrated to direct GA4/Meta
Pixel dispatch via `@/lib/analytics`.

## Migration files

### `migrations/060_rollback.sql` — DELETE (deferred)

| | |
|---|---|
| Status | Reverses the forward split on every fresh DB. Silent footgun. |
| Plan | Move to `scripts/rollback-060.sql` (operator-invoked only); delete from `migrations/`. |

### `migrations/059_grant_direct_order_messages.sql` + `migrations/059_vendor_applications.sql` — RENAME (deferred)

Filename-sort collision. Second migration should be renamed to
`migrations/059b_vendor_applications.sql`.

## iOS / 3rd-party API contract

The iOS folder references several response-shape aliases
(`addressId`, `deliveryAddressId`, etc.) that are legacy. Migrating
those requires the iOS team to ship a coordinated update; tracked
as out-of-scope for the consolidation branch.

## Plan summary

| Status | Count |
|---|---|
| CANONICAL | 6 (verified) |
| COMPATIBILITY | 0 |
| DEPRECATED | 1 (`POST /api/v1/orders`) |
| DELETE (this branch) | 0 (all pre-existing deletions closed in `16e822a` + `4d64ec9`) |
| DELETE (deferred) | 1 (`060_rollback.sql`) |
| RENAME (deferred) | 1 (`059_vendor_applications.sql` → `059b_*`) |
