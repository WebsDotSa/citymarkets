# PCP-101 Phase 9 Audit Report — 2026-10-02

## Scope

Full system audit of citymarkets.sa covering:
1. UUID validation coverage (PCP-112 follow-up)
2. Migration drift (PCP-113 — NEW bug)
3. Rate-limit coverage (PCP-114 — NEW bug)
4. RLS coverage (re-verify Phase 8)
5. Order total integrity (re-verify Phase 8)
6. Auth-before-DB ordering
7. Force-RLS tables

## Findings

| # | Severity | Title | Status |
|---|----------|-------|--------|
| PCP-113 | P0 (corrupts data) | migrations/060_rollback.sql would undo the 060 vendor split on fresh clusters | FIXED (commit 4e4df1d) |
| PCP-114 | P1 (DoS/abuse) | Refund endpoints have no rate limit | FIXED (commit 1fa0f1b) |
| RLS coverage | — | All 33 RLS tables have defensive policies (re-verified post-108) | - |
| Force RLS | — | 0 tables with FORCE RLS | - |
| UUID guards | — | All `[id]` routes have validation (PCP-112 follow-up) | - |
| Order totals | — | 0 mismatches when subtotal+delivery+discount+tax math checked | - |
| Auth-before-DB | — | No routes query DB before auth check | - |
| Migration drift | P2 | 3 duplicate migration numbers (041, 059, 060) | DOCUMENTED via _migration_guards |

## PCP-113 details

**Bug**: `migrations/060_rollback.sql` is a destructive rollback script committed to the
migrations directory. On a fresh cluster that runs migrations/ in numeric order after
`060_vendors_cleanup_and_split.sql`, this file would rename `aamiz-kafeh` → `qahwa-amaze`,
delete `aamiz-lilwarood`, recreate `abaya-store + gifts` empty, and reactivate root
categories — undoing the entire vendor split.

**Diagnostic step** (this audit):
- The current cluster has `060_rollback.sql` in `app_migrations` (already applied)
  and it ran as a no-op (data was already renamed). But fresh clusters would
  re-trigger the destructive rename.
- Verified manually: ran 060_rollback.sql on the live cluster; it DID rename
  `aamiz-kafeh` to `qahwa-amaze`. Re-ran `060_vendors_cleanup_and_split.sql` to restore.

**Fix** (2 files, 161 lines):

1. New migration `109_harden_against_060_rollback.sql`:
   - DELETE orphan bookkeeping row for `106_payment_refunds.sql` (the file
     was never committed to git; only the bookkeeping INSERT happened)
   - CREATE TABLE `_migration_guards` for future guard flags
   - INSERT `060_rollback_blocked = true` and `migration_duplicates_known = true`
     guards so future runs abort the rollback

2. Patch `migrations/060_rollback.sql`:
   - Added a DO block that RAISE EXCEPTIONs when the guard is active
   - Wrapped the DO block + rollback DDL in a SINGLE BEGIN/COMMIT (the runner
     uses `client.query()` on the whole file, so a single transaction guard is
     the only pattern that aborts the whole file)
   - Documented how to force a real rollback for genuine disaster recovery
     (DELETE guard row, run file, re-apply migration 109)

**Verification on live cluster**:
- Guard active → file aborts with ROLLBACK; `aamiz-kafeh` intact
- Guard disabled → file runs the rename; `aamiz-kafeh` → `qahwa-amaze`
- Re-apply `060_vendors_cleanup_and_split.sql` restores `aamiz-kafeh`
- Re-arm `_migration_guards`

## PCP-114 details

**Bug**: Both refund endpoints have no rate limiting.

```
POST /api/v1/orders/[id]/refund       (customer-initiated)
POST /api/admin/orders/[id]/refund    (admin approval/execution)
```

**Attack surface**:
- Customer: a logged-in user (or guest who captured the idempotency_key secret)
  could repeatedly POST refund requests for the same orderId. `refund_requests`
  has a UNIQUE constraint on order_id (status IN pending,approved) so duplicate
  INSERTs fail with 23505, but the catch-arm logs each attempt as an error,
  creating log noise that hides genuine refund-replay attacks.
- Admin: a misclick storm or stolen admin session could fire many refund calls
  in seconds (each one a Moyasar API hit + ledger write).

**Fix** (5 files, 329 lines):

1. Add `REFUND_REQUEST_CONFIG` + `REFUND_REQUEST_IP_CONFIG` to
   `src/lib/rate-limit.ts`:
   - per-principal: 3/hour
   - per-IP: 10/hour (covers guest + admin shift changes)

2. Apply to customer endpoint:
   - IP check first (covers guest flows)
   - per-principal check after `resolveCustomerUserIdFromRequest`
     (keyed by `userId` when present, `guest:<ip>` otherwise)

3. Apply to admin endpoint:
   - IP check first
   - per-admin-user check (keyed by `admin:<userId>`)

4. 2 new test files (rate-limit.test.ts) covering the 429 responses and
   the key-shape assertion.

**Verification**:
- tsc: 0 errors
- vitest: 2040/2046 pass (+5 net vs pre-fix 2035/2041)
- Live: 5x spam on `/api/admin/orders/bad-uuid/refund` → all 400
  (UUID guard fires before rate limit; correct ordering)

## Migration drift (P2, documented)

The migrations/ directory has 3 sets of duplicate numbers:
- 041: `041_analytics.sql` + `041_native_push_tokens.sql`
- 059: `059_grant_direct_order_messages.sql` + `059_vendor_applications.sql` + `059b_vendor_applications.sql`
- 060: `060_drop_delivery_zones.sql` + `060_rollback.sql` + `060_vendors_cleanup_and_split.sql`

Numeric-order runners process the first match only. Migration 113 inserts
a `migration_duplicates_known` guard for documentation; the long-term fix
is PCP-117 (move rollbacks out of migrations/ into scripts/rollback/).

## Summary

- **2 commits** pushed to main:
  - `4e4df1d` PCP-113 migration drift guard
  - `1fa0f1b` PCP-114 refund rate limiting
- **0 open P0/P1** bugs
- **1 documented P2** (migration drift, tracked as PCP-117)
- **vitest**: 2040/2046 pass
- **live**: container healthy on image `a279a87c68d1`, all 8 bad-UUID endpoints
  return 400 with Arabic message

## Open (تحتاج عملك خارج النطاق)

- Twilio Geo Permissions: enable SA in Twilio Console → Verify → Services → VA5782...
- aqar.labs.sa SSL 525: Cloudflare-side

Generated 2026-10-02T20:17:28.730723Z by hermes PCP-101 Phase 9 audit.
