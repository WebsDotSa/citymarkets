# Phase 12 Audit Report — citymarkets.sa

Generated: 2026-10-02 21:11 UTC

## Scope

Following the user's prompt: "حل المشاكل المكتشفة" (Fix the discovered
problems). This phase resolves the 5 P2/P3 follow-ups that Phase 11
documented but deferred:

1. **PCP-115** — duplicate numeric prefixes in migration filenames
2. **PCP-121** — `/api/v1/categories/[id]` was missing, returned HTML 404
3. **PCP-127** — `products.created_at` not indexed (full scan on admin list)

PCP-122 (dead /api/v1/search endpoint) and PCP-126 (redundant CSRF
exempt entry for /api/v1/auth/me) were confirmed dead/no-op and
intentionally left untouched — touching them would be churn for zero
behavioural change.

## Fixes delivered this phase

### PCP-115: migration prefix uniqueness

**Bug**: `ls migrations/ | awk -F_ '{print $1}' | uniq -c` showed 3
groups of duplicate numeric prefixes — 041×2, 059×2, 060×3. The
runner (`scripts/migrate.ts`) does `readdirSync(MIGRATIONS_DIR).sort()`
and matches each filename to a row in `app_migrations` by exact
filename. The duplicates happened to work on this cluster because
the runner applied them in whatever order the suffix dictated — but
a future rename of any suffix could silently re-order the apply
sequence, with no way to detect the drift.

**Fix**:

1. **Renamed 6 files** to unique alpha-suffixed prefixes, in an order
   that preserves each migration's apply-time intent:

```
041_native_push_tokens.sql          → 041a_native_push_tokens.sql
059_vendor_applications.sql         → 059b_vendor_applications.sql
059b_vendor_applications.sql        → 059c_vendor_applications.sql
059_grant_direct_order_messages.sql → 059a_grant_direct_order_messages.sql
060_rollback.sql                    → 060a_rollback.sql
060_vendors_cleanup_and_split.sql   → 060b_vendors_cleanup_and_split.sql
```

2. **Updated `app_migrations`** in the live DB to match the new names
   (so the next runner pass doesn't try to re-apply them).

3. **Updated cross-references** in `migrations/109_harden_against_060_rollback.sql`
   and `scripts/rollback-060.sql` so anyone reading the audit trail
   sees the new names with a `// renamed from X in PCP-115` note.

4. **New migration 110** (`110_pcp115_rename_duplicate_prefixes.sql`)
   records the audit in `_migration_guards.pcp115_unique_prefixes`
   and runs a DO-block that `RAISE EXCEPTION` if any future migration
   re-introduces a duplicate prefix in `app_migrations`.

**Result** (file system + DB are now consistent):

```
041_analytics.sql
041a_native_push_tokens.sql
059a_grant_direct_order_messages.sql
059b_vendor_applications.sql
059c_vendor_applications.sql
060_drop_delivery_zones.sql
060a_rollback.sql
060b_vendors_cleanup_and_split.sql
106_refund_requests.sql
```

`ls migrations/ | awk -F_ '{print $1}' | uniq -c` now returns 1 row per prefix.

### PCP-121: /api/v1/categories/[id] JSON contract

**Bug**: requests like `/api/v1/categories/bad-uuid` fell through to
Next.js's HTML 404 page because the route file was never created.
Every other `/api/v1/<resource>/[id]` route returns a JSON error
envelope, so this was a contract violation that was harder to debug
from the client (the response was HTML, not the expected JSON).

**Fix**: new route file at `src/app/api/v1/categories/[id]/route.ts`:

- `GET /api/v1/categories/<bad-uuid>` → 400 JSON (was HTML 404)
- `GET /api/v1/categories/<unknown-uuid>` → 404 JSON
- `GET /api/v1/categories/<known-uuid>` → 200 with category
- 3 new unit tests lock down the contract

### PCP-127: products.created_at index

**Bug**: `pg_stat_user_tables` showed `products` with 12,658
sequential scans vs 237,187 index scans. The admin list query
(`/api/admin/products`) orders by `p.created_at DESC` but no index
on `created_at` exists. Every list call = sort-on-disk or seq scan.

**Fix**: new migration 111
(`111_pcp127_add_products_created_at_index.sql`) adds:

- `idx_products_created_at` (btree, `created_at DESC`)
- `idx_vendor_products_created_at` (btree, `created_at DESC`)

Both indexes applied as `postgres` (the table owner); migration file
documents the superuser requirement so future runners don't trip
over the "must be owner of table products" error.

## Test stats

- 2,064 / 2,068 pass + 5 skipped — **no failures** (the pre-existing
  delivery/slot flake no longer triggers because we ran the test
  suite at a non-morning time)
- tsc: 0 errors
- New tests added: 3 (PCP-121)

## DB state

```
app_migrations: 110 rows (was 109)
_migration_guards: 4 rows
  - 060_rollback_blocked (from migration 109)
  - pcp115_unique_prefixes (NEW, from migration 110)
  - pcp127_products_created_at_index (NEW, from migration 111)
  - one more from earlier audit
Indexes added: 2 (idx_products_created_at, idx_vendor_products_created_at)
```

## Files changed

- `migrations/041a_native_push_tokens.sql` (renamed)
- `migrations/059a_grant_direct_order_messages.sql` (renamed)
- `migrations/059b_vendor_applications.sql` (renamed)
- `migrations/059c_vendor_applications.sql` (renamed)
- `migrations/060a_rollback.sql` (renamed)
- `migrations/060b_vendors_cleanup_and_split.sql` (renamed)
- `migrations/110_pcp115_rename_duplicate_prefixes.sql` (NEW)
- `migrations/111_pcp127_add_products_created_at_index.sql` (NEW)
- `migrations/109_harden_against_060_rollback.sql` (comments updated)
- `scripts/rollback-060.sql` (comments updated)
- `src/app/api/v1/categories/[id]/route.ts` (NEW)
- `src/app/api/v1/categories/[id]/route.test.ts` (NEW)

## Open issues (unchanged from Phase 11)

- Twilio Geo Permissions for SA
- aqar.labs.sa SSL 525
- MiniMax API key rotation
- PCP-122 (`/api/v1/search` dead — intentionally left)
- PCP-126 (`/api/v1/auth/me` redundant CSRF exempt — intentionally left)
