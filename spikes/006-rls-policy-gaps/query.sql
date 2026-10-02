-- 006 — rls-policy-gaps
-- Theory: 21 tables have rowsecurity=off. Some are fine (system tables,
-- _migration_guards), but others might hold user-private data and need
-- policies. Identify which of the rls-off tables hold customer/employee
-- data, and decide: (a) needs RLS, (b) owned by postgres so role bypass
-- is fine, (c) only-written-by-trusted-role.

-- 6a: full list of rls-off tables, with row count, owner, and whether
--     they reference users (so RLS would matter)
SELECT
  c.relname AS tbl,
  pg_get_userbyid(c.relowner) AS owner,
  pg_size_pretty(pg_total_relation_size(c.oid)) AS size,
  (SELECT n_live_tup FROM pg_stat_user_tables WHERE relname=c.relname) AS n_live,
  c.relrowsecurity AS rls_on,
  c.relforcerowsecurity AS rls_forced,
  -- does this table reference users.id?
  EXISTS (
    SELECT 1 FROM pg_constraint cc
    JOIN pg_attribute a ON a.attrelid=cc.conrelid AND a.attnum=cc.conkey[1]
    WHERE cc.contype='f' AND cc.confrelid='public.users'::regclass
      AND cc.conrelid=c.oid
  ) AS has_user_fk
FROM pg_class c
JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relkind='r' AND NOT c.relrowsecurity
ORDER BY has_user_fk DESC, pg_total_relation_size(c.oid) DESC;
