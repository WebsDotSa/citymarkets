-- Step 1: Schema inventory (top 50 tables by size)
SELECT n.nspname AS schema,
       c.relname AS table,
       pg_total_relation_size(c.oid) AS bytes,
       pg_size_pretty(pg_total_relation_size(c.oid)) AS pretty,
       c.reltuples::bigint AS row_estimate
FROM pg_class c
JOIN pg_namespace n ON c.relnamespace = n.oid
WHERE n.nspname NOT IN ('pg_catalog','information_schema')
  AND c.relkind = 'r'
ORDER BY pg_total_relation_size(c.oid) DESC
LIMIT 50;
