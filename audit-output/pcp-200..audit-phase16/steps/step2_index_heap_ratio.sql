-- Step 2: Index/heap ratio (tables with high index ratio vs missing indexes)
SELECT schemaname, relname,
       pg_size_pretty(pg_total_relation_size(relid)) AS total,
       pg_size_pretty(pg_indexes_size(relid)) AS indexes,
       round(100.0 * pg_indexes_size(relid) / nullif(pg_total_relation_size(relid),0), 1) AS idx_pct
FROM pg_stat_user_tables
WHERE pg_total_relation_size(relid) > 1024*1024
ORDER BY pg_total_relation_size(relid) DESC
LIMIT 20;