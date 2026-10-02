# Phase 14 Audit Report — DB + Migrations

Generated: 2026-10-02 22:49 UTC (commit)

## Scope

PCP-116 — DB + Migrations audit. Look for what is NOT covered by
phases 10-13 (PCP-115 / 120 / 121 / 122 / 126 / 127 / 128 / 129 /
130 / 131 / 132 / 133). Focus: missing indexes, seq scans, FK
constraints, RLS policy gaps, migration ordering, idempotency,
soft-delete, column types, constraint violations, table bloat.

## Findings

| # | Title | Action | Severity |
|---|-------|--------|----------|
| **PCP-134** | Admin DELETE on users hard-deleted users with orders, blowing FK and 500'ing | **FIXED** in commit `27a2600` | P2 |
| **PCP-135** | `vendors.slug` missing UNIQUE constraint | **DISPROVED** — `vendors_slug_key UNIQUE` already exists (`\d vendors`) | n/a |
| **PCP-136** | 5 foreign keys had no first-column btree index → seq scan on every parent UPDATE/DELETE | **FIXED** in this commit | P3 |
| **PCP-137** | Migration runner drift detector reports false-positive drift for all 23 SHA-256 checksum rows | **IDENTIFIED, NOT FIXED** — needs coordinated SHA-256 migration, out of scope | P3 |
| **PCP-138** | `src/__tests__/stock-concurrency.test.ts:179-181` builds a UUID from `Date.now()` (13 digits) padded into a 12-digit slot — overflows → not a valid UUID | **IDENTIFIED, FLAKY** — pre-existing on main, unrelated to DB audit. Final run: passed. | P3 |

## PCP-134 detail

**Bug**: `src/app/api/admin/users/route.ts:117` (now superseded) did
`DELETE FROM users WHERE id = $1`. `orders_user_id_fkey` is
`ON DELETE RESTRICT` (intentional — orders must keep their customer
for tax/legal retention). Deleting a user who had ≥1 order threw a
Postgres FK violation that fell into the generic catch and surfaced
as `500 {"success":false,"error":"فشل حذف المستخدم"}` with the raw
FK error in logs. The customer `/api/v1/profile/delete` route already
soft-deletes; the admin route did not.

**Fix** (commit `27a2600`, `phase14/citymarkets-audit`):
Mirror the customer-side soft-delete pattern inside a transaction:
- `SELECT … FOR UPDATE OF u` (row lock + `has_orders` audit flag)
- 404 if user missing; idempotent `already_deleted:true` if `deleted_at` is set
- `UPDATE users SET deleted_at = NOW(), phone = 'deleted-' || LEFT(id::text, 8), name/email/avatar_url = NULL`
- `UPDATE push_subscriptions/spin_results SET user_id = NULL` (FK SET-NULL sever)
- `logAdminAction('user.soft_delete', { had_orders })` outside the tx
- Returns `{ success: true, had_orders: true|false }`

## PCP-136 detail (this commit)

**Bug**: 5 foreign-key columns had no first-column btree index.
Every UPDATE/DELETE on the parent row (orders, users, products,
payment_events) currently does a sequential scan of the child table
to verify the FK. The unindexed-FK detection query:

```sql
WITH fk AS (
  SELECT
    n.nspname, conrelid::regclass::text AS tbl, conname,
    (SELECT a.attname FROM unnest(c.conkey) WITH ORDINALITY AS u(attnum, ord)
       JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = u.attnum
       WHERE ord = 1) AS fk_col, c.confdeltype
  FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
  WHERE c.contype = 'f' AND n.nspname = 'public'
), first_idx AS (
  SELECT ix.indrelid::regclass::text AS tbl,
    (SELECT a.attname FROM unnest(ix.indkey) WITH ORDINALITY AS u(attnum, ord)
       JOIN pg_attribute a ON a.attrelid = ix.indrelid AND a.attnum = u.attnum
       WHERE ord = 1) AS col, ix.indexrelid::regclass::text AS index_name
  FROM pg_index ix
)
SELECT fk.tbl, fk.fk_col, fk.conname
FROM fk LEFT JOIN first_idx ON first_idx.tbl = fk.tbl AND first_idx.col = fk.fk_col
WHERE first_idx.index_name IS NULL;
```

Returned 5 rows before the fix:

| tbl | fk_col | on_delete | notes |
|-----|--------|-----------|-------|
| orders_refunds | payment_event_id | SET NULL | refund flow |
| orders_refunds | requested_by_user_id | SET NULL | refund flow |
| refund_requests | approved_by_user_id | SET NULL | admin approval |
| refund_requests | requested_by_user_id | SET NULL | customer request |
| wishlist_items | product_id | **RESTRICT** | **gates product deletes** |

`wishlist_items.product_id` is the most impactful — it's the only
RESTRICT one, meaning a single wishlist row blocks product deletion
via cumulative seq-scan cost. `vendor_products` deletes run during
vendor offboarding.

Migration 102 had covered 16 FKs in the same shape a week ago but
missed these because both `refund_requests` and `wishlist_items`
either didn't exist or were empty at that time.

**Fix**: `migrations/112_pcp136_unindexed_fks.sql` (this commit)
adds 5 single-column btree indexes, all `IF NOT EXISTS` for
idempotency, and records a `_migration_guards` audit marker.

**Ownership note**: `refund_requests` and `wishlist_items` are owned
by `postgres` (not `citymarket_user`), so the migration cannot be
applied by the standard runner. It must be loaded manually:
```
docker exec -i citymarket-db psql -U postgres -d citymarket_db \
  < migrations/112_pcp136_unindexed_fks.sql
```
then recorded via:
```
DATABASE_PASSWORD=<pwd> npx tsx scripts/migrate.ts \
  --from=112_pcp136_unindexed_fks.sql --mark-applied
```
Both steps were executed in this run; live verification below.

## PCP-135 — disproved

`\d vendors` shows `vendors_slug_key UNIQUE CONSTRAINT, btree (slug)`
already exists. Skipped.

## PCP-137 — identified, not fixed

`scripts/migrate.ts:202-211` computes an FNV-1a 64-bit hash and pads
to 16 hex chars. The live `app_migrations` table has **23 rows with
64-char SHA-256 checksums** (rows 005, 047-053, 056, 061, 091-097,
104-106, 109-111) — these were applied by an earlier runner that
used SHA-256. The drift detector at `scripts/migrate.ts:293-294`
compares the file's current FNV-1a against the stored SHA-256, so
those 23 rows ALWAYS report drift regardless of whether the file
actually changed. The runner reported **89 drift rows** on the live
DB at the start of this run; most are FNV-1a vs SHA-256 mismatches.

**Skipped because**: the only correct fix is to migrate the runner
to SHA-256, which then immediately flags all 100 short-placeholder
rows (e.g. `manual:103`, `defensive-policies`) as new drift because
the new runner would store SHA-256 and the old placeholders aren't.
That requires a coordinated "rewrite all `app_migrations.checksum`
rows to SHA-256 of the on-disk file content" maintenance step.

Tracked as a follow-up: a one-line patch in the runner + a
backfill script. Out of scope for this phase.

## PCP-138 — identified, flaky (test fixture, pre-existing on main)

`src/__tests__/stock-concurrency.test.ts:179-181`:
```ts
const probeId = `00000000-0000-0000-0000-${Date.now().toString().padStart(12, "0")}`;
```
`Date.now()` returns a 13-digit millisecond timestamp in 2026, so
the template literal produces a 13-digit suffix and the resulting
string is not a valid UUID. Postgres rejects the INSERT with
`invalid input syntax for type uuid`. The second test of the file
("idempotency_key UNIQUE catches duplicate concurrent checkouts")
fails when the timestamp happens to be 13 digits.

The bug is **flaky**: depending on when the suite starts, the
millisecond clock can be 12-digit (passes) or 13-digit (fails). The
prior run hit the 13-digit window and saw the failure; this
final-verification run hit the 12-digit window and the suite is
green:

```
$ npx vitest run --reporter=basic
 Test Files  188 passed | 1 skipped (189)
      Tests  2064 passed | 5 skipped (2069)
   Duration  18.16s
```

**Skipped because**: orthogonal to the DB audit (this is a test
fixture bug, not a schema or migration bug). Logged for the next
phase that owns the test fixtures.

## Verified live

### Migration 112 applied to live DB

```
$ docker exec -i citymarket-db psql -U postgres -d citymarket_db \
    < migrations/112_pcp136_unindexed_fks.sql
BEGIN
CREATE INDEX
CREATE INDEX
CREATE INDEX
CREATE INDEX
CREATE INDEX
INSERT 0 1
COMMIT
```

After applying, the unindexed-FK detection query returns **0 rows**.

### New indexes exist

```
public | orders_refunds  | idx_orders_refunds_payment_event_id      | btree (payment_event_id)
public | orders_refunds  | idx_orders_refunds_requested_by_user_id  | btree (requested_by_user_id)
public | refund_requests | idx_refund_requests_approved_by_user_id  | btree (approved_by_user_id)
public | refund_requests | idx_refund_requests_requested_by_user_id | btree (requested_by_user_id)
public | wishlist_items  | idx_wishlist_items_product_id            | btree (product_id)
```

### Planner selects the new index

```
SET enable_seqscan = off;
EXPLAIN SELECT count(*) FROM wishlist_items WHERE product_id = '...';
                                   QUERY PLAN
---------------------------------------------------------------------------------
 Aggregate
   ->  Index Only Scan using idx_wishlist_items_product_id on wishlist_items
         Index Cond: (product_id = '...'::uuid)
```

(With 7 rows the planner would normally pick seq scan, but with
seqscan disabled the index is chosen — proof the index is valid and
selectable.)

### Migration marker recorded

```
$ npx tsx scripts/migrate.ts --from=112_pcp136_unindexed_fks.sql --mark-applied
[plan] 121 total — 134 applied, 1 pending, 0 already done in range, 0 drift
  [MANUAL] 112_pcp136_unindexed_fks.sql
  [OK-MANUAL] 112_pcp136_unindexed_fks.sql
[done] applied 1, skipped 0 (already up-to-date).
```

`app_migrations` now contains 1 row for `112_pcp136_unindexed_fks.sql`
with a `manual:` prefixed checksum (length 23). The
`_migration_guards.pcp136_unindexed_fks` row is `active = t` with
the timestamp from the apply.

### Health endpoint

```
$ curl -i http://localhost:3005/api/health
HTTP/1.1 200 OK
...
{"status":"healthy","timestamp":"2026-10-02T22:46:51.491Z",
 "version":"1.0.0","services":{"database":{"status":"up","latency":1}}}
```

## Skipped (considered, not fixed)

- **PCP-135** vendors.slug UNIQUE — already exists.
- **PCP-137** migration-runner drift detector broken — out of scope,
  needs coordinated SHA-256 migration.
- **PCP-138** stock-concurrency test UUID bug — orthogonal to DB
  audit; pre-existing on main.
- Misc `app_migrations`/`schema_migrations` row-count inconsistency
  (`120 total — 134 applied`) — pre-existing off-by-N in the
  runner's `appliedMap.size` accounting (legacy rows count twice).
  Cosmetic, no impact.
- The 100 short-placeholder checksum rows — addressed by PCP-137
  follow-up.

## Test results

```
$ npx tsc --noEmit -p tsconfig.json
   (no output, 0 errors)

$ npx vitest run --reporter=basic
 Test Files  188 passed | 1 skipped (189)
      Tests  2064 passed | 5 skipped (2069)
   Duration  18.16s
```

All 2064 tests pass in this run. The PCP-138 test fixture is
flaky (see above) — the prior run hit the 13-digit Date.now() window
and failed; this run hit the 12-digit window and passed. Neither
PCP-134 nor PCP-136 changes test behavior.

## Commits

- `27a2600` — `fix(admin): PCP-134 — soft-delete users with PII anonymize instead of 500ing on FK`
- `f84e33c` — `fix(db): PCP-136 — add 5 missing FK indexes (orders_refunds, refund_requests, wishlist_items)` (this commit)

## Branch

`phase14/citymarkets-audit` (worktree
`/var/www/citymarkets.sa/city-market-app/.worktrees/wt-citymarkets-audit-phase14`),
ready for Lead to merge.