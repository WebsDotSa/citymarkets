# 004 — unindexed-soft-delete-filters

## Question
**Theory**: Every `WHERE deleted_at IS NULL` predicate is a filter on
a low-cardinality column (mostly NULL, occasional timestamp). A btree
index on `deleted_at` is NOT useful because most values are NULL — a
partial index `WHERE deleted_at IS NULL` is the right tool.

## Approach
1. List every table with a `deleted_at` column
2. Check existing indexes for `deleted_at` coverage
3. Verify the partial-index pattern is being used (or not needed)

## Query
See `query.sql`.

## Raw output
```
tbl|size|n_live|idx_count
users|3768 kB|19925|4
```

Only 1 table has `deleted_at` — `users` (19,925 rows).

Existing indexes on users:
- `users_pkey` (id, unique btree)
- `idx_users_deleted_at` (partial btree WHERE deleted_at IS NOT NULL) ✓
- `idx_users_email_lower` (partial btree WHERE email IS NOT NULL)
- `uniq_users_phone_active` (partial unique btree WHERE deleted_at IS NULL) ✓

## Verdict: **DISPROVED**
- Only 1 table has `deleted_at`
- The existing indexes already include:
  - A partial index on `deleted_at IS NOT NULL` (for admin scans of
    the soft-deleted tombstone set)
  - A partial unique on `phone WHERE deleted_at IS NULL` (for
    active-user login uniqueness)
- The actual login query filters on `phone` and uses
  `uniq_users_phone_active` — the most selective available index
- No `WHERE deleted_at IS NULL` query exists in the codebase outside
  the login check (which is `WHERE phone = $1` first, then checks
  `deleted_at` in app code)

## Recommendation
No fix needed. Keep the spike query as a regression check.
