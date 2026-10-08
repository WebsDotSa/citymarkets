-- Step 4: FK columns with no matching index
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
    WHERE i.indrelid = (SELECT oid FROM pg_class WHERE relname = tc.table_name)
      AND kcu.column_name = ANY (i.indkey::text::text[])
  )
ORDER BY tc.table_name, kcu.column_name;