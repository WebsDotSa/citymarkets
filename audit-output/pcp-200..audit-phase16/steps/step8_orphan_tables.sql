-- Step 8: Orphan tables — never ANALYZE'd, public schema
SELECT c.relname, pg_size_pretty(pg_total_relation_size(c.oid)) AS size
FROM pg_class c
LEFT JOIN pg_stat_user_tables s ON s.relid = c.oid
WHERE c.relkind = 'r'
  AND c.relnamespace = (SELECT oid FROM pg_namespace WHERE nspname='public')
  AND s.last_analyze IS NULL
  AND s.last_autoanalyze IS NULL
  AND pg_total_relation_size(c.oid) > 0
ORDER BY pg_total_relation_size(c.oid) DESC
LIMIT 20;