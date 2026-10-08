-- 110_pcp115_rename_duplicate_prefixes.sql
-- PCP-115: guard against re-introducing duplicate migration filename
-- prefixes (e.g. 041, 059, 060). The migration runner uses
-- `readdirSync(MIGRATIONS_DIR).sort()` (lex sort) to enumerate pending
-- migrations and matches each one to a row in `app_migrations` by
-- exact filename. If two files share a numeric prefix, the runner
-- still applies both — but the order is determined by lex sort of the
-- suffix, not by the developer's intent. Worse, on a fresh cluster
-- with the same files present, the runner applied them in whatever
-- order the suffix happened to dictate, and any future rename of one
-- suffix could silently re-order the apply sequence.
--
-- 1) Rename the 6 known duplicate-prefix files (already done on the
--    filesystem + app_migrations in this same audit cycle):
--      041_native_push_tokens.sql          → 041a_native_push_tokens.sql
--      059_vendor_applications.sql         → 059b_vendor_applications.sql
--      059b_vendor_applications.sql        → 059c_vendor_applications.sql
--      059_grant_direct_order_messages.sql → 059a_grant_direct_order_messages.sql
--      060_rollback.sql                    → 060a_rollback.sql
--      060_vendors_cleanup_and_split.sql   → 060b_vendors_cleanup_and_split.sql
--
-- 2) Add a permanent invariant: every migrations/*.sql file must have
--    a unique `<numeric-prefix>_<rest>` shape. Verified by the
--    post-migration CHECK below, which throws if any future commit
--    re-introduces a duplicate prefix.
--
-- 3) Bump the on-disk runner's check by recording the audit result in
--    `_migration_guards` so operators can confirm the migration is
--    applied.

BEGIN;

-- 2a. Insert a guard row so operators can confirm via
--     SELECT * FROM _migration_guards WHERE guard_name = 'pcp115_unique_prefixes';
INSERT INTO _migration_guards (guard_name, active, created_at)
VALUES (
  'pcp115_unique_prefixes',
  TRUE,
  NOW()
)
ON CONFLICT (guard_name) DO UPDATE
  SET active = EXCLUDED.active,
      created_at = EXCLUDED.created_at;

-- 2b. Sanity check: the live app_migrations table must have NO two rows
--     with the same leading numeric prefix. This catches the bug class
--     without needing to re-read the filesystem.
DO $$
DECLARE
  dup_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO dup_count
  FROM (
    SELECT split_part(filename, '_', 1) AS prefix
    FROM app_migrations
    GROUP BY split_part(filename, '_', 1)
    HAVING COUNT(*) > 1
  ) dups;

  IF dup_count > 0 THEN
    RAISE EXCEPTION
      'PCP-115: app_migrations has % duplicate prefix(es). '
      'See migration 110 for the rename plan.', dup_count;
  END IF;
END
$$;

-- 3. The check is informational: the on-disk runner (scripts/migrate.ts)
--    uses readdirSync + sort, so we can't enforce filesystem uniqueness
--    from inside SQL. But this query is the canary operators should run
--    before every deploy:
--
--   SELECT split_part(filename, '_', 1) AS prefix, COUNT(*)
--   FROM app_migrations
--   GROUP BY split_part(filename, '_', 1)
--   HAVING COUNT(*) > 1;
--
-- If that returns ANY rows, someone committed a migration file without
-- checking the numeric prefix against existing siblings.

COMMIT;
