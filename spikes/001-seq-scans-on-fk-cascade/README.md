# 001 — seq-scans-on-fk-cascade

## Question
**Theory**: Every FK should have a btree index on its first column.
Otherwise, parent UPDATE/DELETE has to seq-scan the child to verify FK.
Phase 14 covered 5 FKs (PCP-136, migration 112). Did they catch them all?

## Approach
1. Query `pg_constraint` for every FK in public schema
2. Join with `pg_index` to find the first-column btree index on that table
3. Return the difference

## Query
See `query.sql` — standard unindexed-FK detector used in Phase 14.

## Raw output
```
tbl|fk_col|conname|confdeltype
(0 rows)
```

## Verdict: **DISPROVED** (no new findings)
Phase 14 migration `112_pcp136_unindexed_fks.sql` caught the last 5
unindexed FKs. No PCP assigned.

## What worked
- Migration 112 was applied successfully
- Re-running the same detector 24h later returns 0 rows
- All 38+ FKs in the public schema now have first-column btree indexes

## Recommendation
- Keep the detector query in a test (`spikes/001-seq-scans-on-fk-cascade/query.sql`)
  so the next refactor can re-run it and catch regressions.
- No new migration needed.
