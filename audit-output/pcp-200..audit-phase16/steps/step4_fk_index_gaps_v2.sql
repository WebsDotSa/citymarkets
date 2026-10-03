-- Step 4 fixed: FK columns with no matching index (use array_to_string for indkey)
SELECT tc.table_name,
       kcu.column_name,
       c.conname AS fk_name
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
  ON tc.constraint_name = kcu.constraint_name
JOIN pg_constraint c ON c.conname = tc.constraint_name
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND c.contype = 'f'
  AND NOT EXISTS (
    SELECT 1 FROM pg_index i
    JOIN pg_class cls ON cls.oid = i.indrelid
    WHERE cls.relname = tc.table_name
      AND kcu.column_name = ANY (
        SELECT pg_get_indexdef(i.indexrelid, k.attnum+1, true)
        FROM generate_series(0, i.indnkeyatts-1) AS k(attnum)
      )
  )
ORDER BY tc.table_name, kcu.column_name;