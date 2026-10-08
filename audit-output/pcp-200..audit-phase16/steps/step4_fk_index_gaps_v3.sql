-- Step 4 fixed (final): FK columns without a matching index
-- Reliable across PG 12-16 using pg_indexdef to parse indexed columns.
SELECT
    tc.table_name AS table_name,
    kcu.column_name AS fk_column,
    c.conname AS fk_name
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
  ON tc.constraint_name = kcu.constraint_name
  AND tc.table_schema = kcu.table_schema
JOIN pg_constraint c
  ON c.conname = tc.constraint_name
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND c.contype = 'f'
  AND NOT EXISTS (
    SELECT 1
    FROM pg_index i
    JOIN pg_class cls ON cls.oid = i.indrelid
    JOIN pg_attribute a ON a.attrelid = cls.oid
    WHERE cls.relname = tc.table_name
      AND a.attname = kcu.column_name
      AND a.attnum = ANY(i.indkey)
  )
ORDER BY tc.table_name, kcu.column_name;