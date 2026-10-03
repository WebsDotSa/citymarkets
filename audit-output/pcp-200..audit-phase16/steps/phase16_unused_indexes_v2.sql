-- Phase-16: Find UNUSED indexes (idx_scan = 0 since stats reset, non-unique)
SELECT
    schemaname,
    relname AS table_name,
    indexrelname AS index_name,
    pg_size_pretty(pg_relation_size(indexrelid)) AS index_size,
    idx_scan,
    pg_get_indexdef(indexrelid) AS definition
FROM pg_stat_user_indexes
WHERE idx_scan = 0
  AND indexrelname NOT LIKE '%_pkey'
  AND indexrelname NOT LIKE '%_key'
ORDER BY pg_relation_size(indexrelid) DESC
LIMIT 40;