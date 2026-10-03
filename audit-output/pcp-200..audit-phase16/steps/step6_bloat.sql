-- Step 6: Bloat (top 10 by wasted MB) — LIMIT 5 for safety on smaller DBs
SELECT current_database(), schemaname, tablename,
       round((CASE WHEN otta=0 THEN 0.0 ELSE sml.relpages::float/otta END)::numeric, 2) AS bloat_ratio,
       pg_size_pretty((bs*1.0/1024/1024)::bigint::numeric::bigint) AS wasted_mb
FROM (
  SELECT schemaname, tablename, bs,
    CEIL((cc.reltuples*((datahdr+ma-(CASE WHEN datahdr%ma=0 THEN ma ELSE datahdr%ma END)))::float)/bs) AS otta,
    cc.relpages
  FROM (SELECT schemaname, tablename,
    (SELECT (setting::float)*1024 FROM pg_settings WHERE name='block_size') AS bs,
    cc.reltuples, cc.relpages, cc.reltoastrelid,
    COALESCE((
      SELECT 1+CEIL(pg_column_size(att.attname))::float/8
      FROM pg_attribute att
      WHERE att.attrelid = c.oid AND att.attnum = 1
    ), 1024) AS ma
  FROM pg_class c JOIN pg_stat_user_tables cc ON c.oid=cc.relid) t
  JOIN pg_class c ON c.relname = t.tablename
  JOIN pg_attribute att ON att.attrelid = c.oid AND att.attnum = 1
) sml
WHERE sml.relpages - otta > 0
ORDER BY sml.relpages - otta DESC
LIMIT 10;