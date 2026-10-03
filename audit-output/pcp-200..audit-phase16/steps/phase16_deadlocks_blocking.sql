-- Phase-16: deadlocks and blocking (broader)
SELECT count(*) AS deadlocks_ever FROM pg_stat_database WHERE datname = 'citymarket_db';

-- Reset timestamp of pg_stat_database stats (helps RPO baseline)
SELECT datname, stats_reset FROM pg_stat_database WHERE datname='citymarket_db';

-- Active connections snapshot
SELECT pid, datname, usename, application_name, client_addr, state, backend_start, query_start
FROM pg_stat_activity
WHERE datname='citymarket_db'
ORDER BY backend_start;

-- Lock waits
SELECT blocked_locks.pid AS blocked_pid,
       blocked_activity.usename AS blocked_user,
       blocking_locks.pid AS blocking_pid,
       blocking_activity.usename AS blocking_user,
       blocked_activity.query AS blocked_query,
       blocking_activity.query AS blocking_query
FROM pg_catalog.pg_locks blocked_locks
JOIN pg_catalog.pg_stat_activity blocked_activity ON blocked_activity.pid = blocked_locks.pid
JOIN pg_catalog.pg_locks blocking_locks
  ON blocking_locks.locktype = blocked_locks.locktype
  AND blocking_locks.database IS NOT DISTINCT FROM blocked_locks.database
  AND blocking_locks.relation IS NOT DISTINCT FROM blocked_locks.relation
  AND blocking_locks.page IS NOT DISTINCT FROM blocked_locks.page
  AND blocking_locks.tuple IS NOT DISTINCT FROM blocked_locks.tuple
  AND blocking_locks.transactionid IS NOT DISTINCT FROM blocked_locks.transactionid
  AND blocking_locks.pid != blocked_locks.pid
  AND blocking_locks.granted
WHERE NOT blocked_locks.granted;