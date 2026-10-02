-- 009 — table-bloat-and-vacuum
-- Theory: any table with >20% dead tuples and n_dead_tup > 10k needs
-- VACUUM (or autovacuum tuning). Use pg_stat_user_tables for the
-- cheap version, then verify with pgstattuple if anything looks bad.

SELECT
  relname AS tbl,
  n_live_tup,
  n_dead_tup,
  CASE WHEN n_live_tup = 0 THEN 0
       ELSE round(100.0 * n_dead_tup / (n_live_tup + n_dead_tup), 1)
  END AS dead_pct,
  last_vacuum,
  last_autovacuum,
  last_analyze,
  last_autoanalyze
FROM pg_stat_user_tables
WHERE schemaname='public'
  AND n_dead_tup > 1000
ORDER BY n_dead_tup DESC;
