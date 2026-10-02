-- 008 — column-type-mismatches
-- Theory: if a column is `text` but stores UUIDs or ints, the planner
-- can't use a btree index for `WHERE col = $1::uuid` because the
-- column type doesn't match. Look for text columns with uuid-shaped
-- names and no enum/check constraint, and bigint columns that should
-- be int.

-- 8a: text columns that look like they should be typed
SELECT
  c.relname AS tbl,
  a.attname AS col,
  format_type(a.atttypid, a.atttypmod) AS type,
  (SELECT count(*) FROM pg_index i WHERE i.indrelid=c.oid
     AND a.attnum = ANY(i.indkey::int[])
     AND i.indexprs IS NULL) AS in_index
FROM pg_attribute a
JOIN pg_class c ON c.oid=a.attrelid
JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND a.atttypid='text'::regtype
  AND NOT a.attisdropped
  AND a.attnum > 0
  AND (
    a.attname ~* '(_id|uuid|guid)$'
    OR a.attname IN ('phone', 'email', 'ip', 'ip_address', 'status', 'kind', 'type', 'slug')
  )
  AND NOT EXISTS (
    SELECT 1 FROM pg_constraint cc WHERE cc.conrelid=c.oid
      AND cc.contype IN ('c','p') AND a.attnum = ANY(cc.conkey)
  )
ORDER BY c.relname, a.attname
LIMIT 60;
