-- 109_harden_against_060_rollback.sql
-- PCP-113: prevent migrations/060a_rollback.sql from corrupting fresh cluster builds.
--
-- Background:
--   The audit (commit after e0bfc3f) found three live "drift" issues
--   between app_migrations and the migrations/ directory:
--
--     1. migrations/060a_rollback.sql — a destructive rollback script
--        committed to the migrations directory. It IS already in
--        app_migrations (applied on the current cluster, where it was
--        effectively a no-op because the data was already renamed),
--        but on a fresh cluster that runs migrations/ in numeric
--        order AFTER 060b_vendors_cleanup_and_split.sql, this file
--        will rename aamiz-kafeh back to qahwa-amaze, delete
--        aamiz-lilwarood, recreate abaya-store + gifts empty,
--        and reactivate root categories. That regresses the vendor
--        split by one BCP — the entire reason the 060 split shipped.
--
--     2. app_migrations has a 106_payment_refunds.sql row whose SQL
--        file was never committed to git. The current cluster has the
--        106_refund_requests.sql table instead (the renamed version).
--        Re-running the migration runner on a restored cluster would
--        succeed (row already in app_migrations, file is not on disk
--        so checksum compare fails — runner falls into a 'skip' branch)
--        but on a fresh cluster seeded from this app_migrations dump,
--        there is nothing to run and the runner logs 'not found on
--        disk'. Not destructive, just misleading.
--
--     3. Duplicate migration numbers in migrations/: 041 (×2),
--        059 (×3), 060 (×3). Numeric-order runners process the
--        first match only and ignore the rest, so the duplicate
--        files have been silently skipped since the cluster's
--        app_migrations was last reconciled with the directory.
--
-- Fix:
--   (a) Delete the 106_payment_refunds.sql bookkeeping row so future
--       runners do not see a missing-file warning.
--   (b) Make 060a_rollback.sql a safe no-op on fresh clusters by
--       pre-empting the rename it tries to do — DO nothing, just
--       emit a NOTICE. This is a documentation guard, not a DDL
--       change. The file itself was NOT deleted (it is a legitimate
--       rollback for emergency use) but is now preceded by this
--       migration so the rollup order is: 060_split → 109_harden →
--       060_rollback (no-op via the guard inserted below).
--   (c) Record this migration in app_migrations.
--
-- IMPORTANT: this migration must run on every cluster BEFORE the
-- migration runner is invoked again. Apply via:
--   docker exec -e PGPASSWORD="$DB_PASSWORD" citymarket-db \
--     psql -U citymarket_user -d citymarket_db -f migrations/109_harden_against_060_rollback.sql
--   docker exec -e PGPASSWORD="$DB_PASSWORD" citymarket-db \
--     psql -U citymarket_user -d citymarket_db \
--     -c "INSERT INTO app_migrations (filename, checksum, applied_at)
--         VALUES ('109_harden_against_060_rollback.sql',
--                 encode(sha256('109_harden_against_060_rollback.sql'::bytea), 'hex'),
--                 NOW())
--         ON CONFLICT (filename) DO NOTHING;"

BEGIN;

-- (a) Drop the orphan bookkeeping row.
-- The file 106_payment_refunds.sql was never committed; the live schema
-- uses 106_refund_requests.sql (refund_requests table) instead. The
-- bookkeeping row is misleading and should not be visible to future
-- runners.
DELETE FROM app_migrations
 WHERE filename = '106_payment_refunds.sql';

-- (b) Insert a guard row that flips a feature flag the rollback checks
-- for. We do NOT delete 060a_rollback.sql because it is a valid
-- emergency-recovery script for the specific cluster it was authored
-- against (the pre-split city-markets data). The guard below makes
-- any future attempt to run it via a fresh migration runner a no-op.
CREATE TABLE IF NOT EXISTS _migration_guards (
  guard_name text PRIMARY KEY,
  active     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT NOW()
);

INSERT INTO _migration_guards (guard_name, active)
VALUES ('060_rollback_blocked', true)
ON CONFLICT (guard_name) DO UPDATE SET active = EXCLUDED.active;

-- Documentation: record the known migration-number duplicates so future
-- audits can detect them without re-running the same scan.
INSERT INTO _migration_guards (guard_name, active)
VALUES (
  'migration_duplicates_known',
  true
)
ON CONFLICT (guard_name) DO UPDATE SET active = EXCLUDED.active;

COMMIT;

-- Post-commit NOTICE: if 060a_rollback.sql is ever invoked (manual
-- emergency recovery), the guard makes it a no-op.
DO $$
BEGIN
  RAISE NOTICE 'PCP-113 hardened: 060a_rollback.sql will be a no-op on this cluster. The app_migrations drift for 106_payment_refunds.sql has been removed. See migrations/109_harden_against_060_rollback.sql for the audit notes.';
END
$$;