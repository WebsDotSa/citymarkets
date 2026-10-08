-- Step 6 fixed: Top 10 tables by bloat ratio
-- Use pg_stat_user_tables.tablename (the right column on PG 9.16+)
SELECT
    current_database(),
    s.schemaname,
    s.relname AS tablename,
    pg_size_pretty(pg_total_relation_size(s.relid)) AS total,
    pg_size_pretty(pg_relation_size(s.relid)) AS heap_only,
    pg_size_pretty(pg_indexes_size(s.relid)) AS index_only,
    s.n_live_tup,
    s.n_dead_tup,
    round(100.0 * s.n_dead_tup / nullif(s.n_live_tup,0), 1) AS dead_pct,
    s.last_vacuum,
    s.last_autovacuum,
    s.last_autoanalyze
FROM pg_stat_user_tables s
WHERE pg_total_relation_size(s.relid) > 64*1024
ORDER BY pg_total_relation_size(s.relid) DESC
LIMIT 15;