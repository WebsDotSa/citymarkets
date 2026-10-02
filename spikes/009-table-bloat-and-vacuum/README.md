# 009 — table-bloat-and-vacuum

## Question
**Theory**: Any table with >20% dead tuples and n_dead_tup > 10k
needs `VACUUM` (or autovacuum tuning).

## Approach
1. Query `pg_stat_user_tables` for n_dead_tup > 1000
2. Cross-reference with last_autovacuum to see if autovacuum is
   keeping up

## Query
See `query.sql`.

## Raw output
```
(0 rows)
```

No table has more than 1,000 dead tuples.

## Verdict: **DISPROVED**
Autovacuum is keeping up with the workload. No tuning needed.

## Recommendation
None. Keep the query as a periodic health check.
