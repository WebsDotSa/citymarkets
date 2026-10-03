-- Phase-16: top slowest queries via pg_stat_statements if available
SELECT 'pg_stat_statements loaded'::text AS check_, count(*) AS n_statements
FROM pg_stat_statements
WHERE query NOT ILIKE '%pg_catalog%'
LIMIT 5;

-- Top 10 longest mean time queries
SELECT
  substring(query for 100) AS query,
  calls,
  round(mean_exec_time::numeric, 1) AS mean_ms,
  round(total_exec_time::numeric, 1) AS total_ms,
  rows
FROM pg_stat_statements
WHERE calls > 5
ORDER BY mean_exec_time DESC
LIMIT 10;