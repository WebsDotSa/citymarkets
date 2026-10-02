-- 002 — duplicate-or-redundant-indexes
-- Theory: an index whose leading column is also the leading column of another
-- index on the same table is a "redundant" index — Postgres never picks it
-- (it can only use one index per query, and the wider one is always better).
-- Pure write-amp waste.

SELECT a.indrelid::regclass::text AS tbl,
       a.indexrelid::regclass::text AS redundant_idx,
       b.indexrelid::regclass::text AS kept_idx,
       pg_size_pretty(pg_relation_size(a.indexrelid)) AS wasted
FROM pg_index a
JOIN pg_index b
  ON a.indrelid = b.indrelid
 AND a.indexrelid <> b.indexrelid
 AND a.indkey[0] = b.indkey[0]  -- same leading column
 AND a.indkey::int[] @> b.indkey::int[]  -- a is a superset of b
 AND (
   -- a strictly wider than b, OR same key but different INCLUDE / different opclass
   (array_length(a.indkey::int[],1) > array_length(b.indkey::int[],1))
   OR (a.indkey::int[] = b.indkey::int[] AND a.indexprs IS NOT DISTINCT FROM b.indexprs
       AND (a.indclass::oid[] <> b.indclass::oid[] OR a.indexprs::text <> b.indexprs::text))
 )
WHERE a.indexrelid > b.indexrelid
  AND EXISTS (SELECT 1 FROM pg_index x WHERE x.indexrelid = a.indexrelid AND x.indisunique = false)
ORDER BY pg_relation_size(a.indexrelid) DESC;
