-- Step 3: RLS coverage — every table with rls_enabled=false
SELECT n.nspname, c.relname,
       c.relrowsecurity AS rls_enabled,
       c.relforcerowsecurity AS rls_forced
FROM pg_class c
JOIN pg_namespace n ON c.relnamespace = n.oid
WHERE n.nspname NOT IN ('pg_catalog','information_schema')
  AND c.relkind = 'r'
  AND c.relname NOT LIKE '\_%' ESCAPE '\'
ORDER BY n.nspname, c.relname;