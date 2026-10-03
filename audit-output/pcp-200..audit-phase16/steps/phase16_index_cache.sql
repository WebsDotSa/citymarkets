-- Phase-16 specific: index hit ratios (RAM-pressure indicator)
-- Indexes with idx_blks_read > 0 AND idx_blks_hit = 0 are read but never cached.
SELECT s.relname AS table_name,
       i.indexrelname AS index_name,
       i.idx_blks_read,
       i.idx_blks_hit,
       CASE WHEN i.idx_blks_read = 0 THEN NULL
            ELSE round(100.0 * i.idx_blks_hit / (i.idx_blks_read + i.idx_blks_hit), 1)
       END AS hit_pct
FROM pg_stat_user_indexes i
JOIN pg_stat_user_tables s ON s.relid = i.relid
WHERE i.idx_blks_read > 0
ORDER BY i.idx_blks_read DESC
LIMIT 25;

-- Overall table cache hit ratio (cold-cache indicator)
SELECT
    sum(heap_blks_read) AS heap_read,
    sum(heap_blks_hit) AS heap_hit,
    round(100.0 * sum(heap_blks_hit) / nullif(sum(heap_blks_hit) + sum(heap_blks_read),0), 1) AS heap_hit_pct
FROM pg_statio_user_tables;