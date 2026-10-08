-- 001 — seq-scans-on-fk-cascade
-- Theory: every FK should have a btree index on its first column. Otherwise
-- parent UPDATE/DELETE has to seq-scan the child to check FK. Phase 14 covered
-- 5 FKs (PCP-136). Need to confirm zero remain, and re-verify after every
-- new table.

WITH fk AS (
  SELECT
    n.nspname, conrelid::regclass::text AS tbl, conname,
    (SELECT a.attname FROM unnest(c.conkey) WITH ORDINALITY AS u(attnum, ord)
       JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = u.attnum
       WHERE ord = 1) AS fk_col, c.confdeltype
  FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
  WHERE c.contype = 'f' AND n.nspname = 'public'
), first_idx AS (
  SELECT ix.indrelid::regclass::text AS tbl,
    (SELECT a.attname FROM unnest(ix.indkey) WITH ORDINALITY AS u(attnum, ord)
       JOIN pg_attribute a ON a.attrelid = ix.indrelid AND a.attnum = u.attnum
       WHERE ord = 1) AS col, ix.indexrelid::regclass::text AS index_name
  FROM pg_index ix
  WHERE ix.indexprs IS NULL  -- exclude expression indexes (leading col is expression, not a column)
)
SELECT fk.tbl, fk.fk_col, fk.conname, fk.confdeltype
FROM fk LEFT JOIN first_idx ON first_idx.tbl = fk.tbl AND first_idx.col = fk.fk_col
WHERE first_idx.index_name IS NULL
ORDER BY fk.tbl;
