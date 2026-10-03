-- Phase-16: heavy-hitter query patterns from app (via pg_stat_statements alternative:
-- auto_explain, log_statement, or just enable pg_stat_statements via shared_preload_libraries)
SELECT name, setting, source FROM pg_settings WHERE name IN (
  'shared_preload_libraries', 'track_activities', 'track_io_timing',
  'log_min_duration_statement', 'auto_explain.log_min_duration'
);

-- Tables with high dead tuple ratios (autovacuum hasn't been aggressive enough)
SELECT schemaname, relname,
       n_live_tup, n_dead_tup,
       round(100.0 * n_dead_tup / nullif(n_live_tup,0), 1) AS dead_pct,
       last_autovacuum, last_autoanalyze
FROM pg_stat_user_tables
WHERE n_dead_tup > 5
ORDER BY n_dead_tup DESC
LIMIT 20;