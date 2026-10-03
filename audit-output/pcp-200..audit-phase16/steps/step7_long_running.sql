-- Step 7a: Long-running queries (>1 min)
SELECT pid, datname, usename, state, query_start, left(query, 80) AS query
FROM pg_stat_activity
WHERE state IN ('active','idle in transaction')
  AND query_start < now() - interval '1 minute'
ORDER BY query_start;

-- Step 7b: All current activity (counts)
SELECT state, count(*) FROM pg_stat_activity GROUP BY state;

-- Step 7c: pg_stat_database.deadlocks for last 7 days
SELECT datname, deadlocks, xact_commit, xact_rollback,
       pg_size_pretty(pg_database_size(datname)) AS db_size
FROM pg_stat_database
WHERE datname = 'citymarket_db';

-- Step 7d: pg_locks waiting (snapshot)
SELECT mode, count(*) AS waiting
FROM pg_locks WHERE granted = false GROUP BY mode ORDER BY waiting DESC;