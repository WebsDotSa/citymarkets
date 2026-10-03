-- Phase-16: Find UNUSED indexes (idx_scan = 0 since stats reset)
SELECT
    s.schemaname,
    s.relname AS table_name,
    s.indexrelname AS index_name,
    pg_size_pretty(pg_relation_size(i.indexrelid)) AS index_size,
    s.idx_scan,
    i.idx_tup_read,
    i.idx_tup_fetch,
    pg_get_indexdef(i.indexrelid) AS definition
FROM pg_stat_user_indexes s
JOIN pg_stat_user_tables t ON t.relid = s.relid
JOIN pg_stat_user_indexes s ON s.relid = t.relid
JOIN pg_index i ON i.indexrelid = s.indexrelid
WHERE s.idx_scan = 0
  AND NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    WHERE c.conindid = i.indexrelid  -- unique/pk
  )
ORDER BY pg_relation_size(s.indexrelid) DESC
LIMIT 30;