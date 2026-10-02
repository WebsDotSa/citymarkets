-- 004 — unindexed-soft-delete-filters
-- Theory: every `WHERE deleted_at IS NULL` predicate is a filter on
-- a low-cardinality column (mostly NULL, occasional timestamp). A btree
-- index on `deleted_at` is NOT useful because most values are NULL —
-- Postgres' planner won't use it for the *common* case. A partial index
-- `WHERE deleted_at IS NULL` is the right tool, BUT most queries that
-- filter on deleted_at ALSO filter by something selective (id, user_id,
-- slug) and the existing PK/unique already wins. So: prove or disprove
-- that no production query actually needs a deleted_at index.

-- Show tables with deleted_at and row count, plus their existing indexes
SELECT
  c.relname AS tbl,
  pg_size_pretty(pg_total_relation_size(c.oid)) AS size,
  (SELECT n_live_tup FROM pg_stat_user_tables WHERE relname=c.relname) AS n_live,
  (SELECT count(*) FROM pg_index i WHERE i.indrelid=c.oid) AS idx_count
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname='public' AND c.relkind='r'
  AND EXISTS (
    SELECT 1 FROM pg_attribute a
    WHERE a.attrelid=c.oid AND a.attname='deleted_at' AND NOT a.attisdropped
  )
ORDER BY pg_total_relation_size(c.oid) DESC;
