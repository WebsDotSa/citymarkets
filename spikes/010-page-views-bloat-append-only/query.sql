-- 010 — page_views-bloat-append-only
-- Theory: page_views is the largest table (5MB) and is INSERT-only.
-- Append-only tables benefit from: (a) BRIN index on created_at for
-- time-range queries, (b) partitioning by time bucket, (c) retention
-- policy. Look at: row count, write rate, existing indexes, and how
-- the app queries it.

-- 10a: shape of page_views
SELECT
  count(*) AS rows,
  count(DISTINCT created_at::date) AS days_with_data,
  min(created_at) AS first_hit,
  max(created_at) AS last_hit,
  pg_size_pretty(pg_total_relation_size('public.page_views')) AS total_size,
  pg_size_pretty(pg_relation_size('public.page_views')) AS heap,
  pg_size_pretty(pg_indexes_size('public.page_views')) AS idx_size
FROM page_views;

-- 10b: indexes on page_views
SELECT indexrelid::regclass::text AS idx, indexdef
FROM pg_indexes
JOIN pg_index i ON i.indexrelid::regclass::text = indexname
WHERE tablename = 'page_views';

-- 10c: any UPDATE/DELETE calls in the app? (grep result will be in spike notes)
-- 10d: which columns does the app filter on? (grep result will be in spike notes)
