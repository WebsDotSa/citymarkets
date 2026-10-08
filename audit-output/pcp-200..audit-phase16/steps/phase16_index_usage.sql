-- Phase-16: index cache pressure (corrected columns for PG 13+)
-- In pg_stat_user_indexes the columns are idx_scan, idx_tup_read, idx_tup_fetch
SELECT
    s.relname AS table_name,
    i.indexrelname AS index_name,
    i.idx_scan AS scans,
    i.idx_tup_read AS tuples_read,
    i.idx_tup_fetch AS tuples_fetched
FROM pg_stat_user_indexes i
JOIN pg_stat_user_tables s ON s.relid = i.relid
ORDER BY s.relname, i.indexrelname
LIMIT 50;