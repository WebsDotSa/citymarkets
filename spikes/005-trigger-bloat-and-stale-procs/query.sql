-- 005 — trigger-bloat-and-stale-procs
-- Theory: any plpgsql function or trigger not called by app code is
-- dead weight. Also: any trigger that fires on every row of a high-
-- write table (orders, page_views, abandoned_carts) is a perf tax.

-- 5a: count triggers, plpgsql functions, total size
SELECT 'triggers'::text, count(*) FROM pg_trigger t
  JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND NOT t.tgisinternal
UNION ALL
SELECT 'plpgsql functions', count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.prolang = (SELECT oid FROM pg_language WHERE lanname='plpgsql')
UNION ALL
SELECT 'total proc size', pg_size_pretty(sum(pg_relation_size(p.oid))::bigint)::text
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public';

-- 5b: list every trigger with its table, event, timing, function
SELECT
  c.relname AS tbl,
  t.tgname AS trigger_name,
  CASE t.tgtype::int & 66
    WHEN 2 THEN 'BEFORE'
    WHEN 64 THEN 'INSTEAD OF'
    ELSE 'AFTER'
  END AS timing,
  CASE t.tgtype::int & 28
    WHEN 4  THEN 'INSERT'
    WHEN 8  THEN 'DELETE'
    WHEN 16 THEN 'UPDATE'
    WHEN 20 THEN 'INSERT/UPDATE'
    WHEN 12 THEN 'INSERT/DELETE'
    WHEN 24 THEN 'UPDATE/DELETE'
    WHEN 28 THEN 'INSERT/UPDATE/DELETE'
    ELSE t.tgtype::int::text
  END AS event,
  p.proname AS fn_name
FROM pg_trigger t
JOIN pg_class c ON c.oid=t.tgrelid
JOIN pg_namespace n ON n.oid=c.relnamespace
LEFT JOIN pg_proc p ON p.oid=t.tgfoid
WHERE n.nspname='public' AND NOT t.tgisinternal
ORDER BY c.relname, t.tgname;
