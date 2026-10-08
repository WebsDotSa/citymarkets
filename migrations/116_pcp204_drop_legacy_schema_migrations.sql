-- ══════════════════════════════════════════════════════════════
-- 116_pcp204_drop_legacy_schema_migrations.sql
-- PCP-204: drop the dead-weight `public.schema_migrations` table
-- (and its sequence) that survived from the original prisma-migrate
-- era. The runner (`scripts/migrate.ts`) writes to `app_migrations`
-- exclusively; `schema_migrations` is 18 rows + 1 sequence that
-- nothing reads. Discovered during the Phase 16 audit
-- (`audit-output/pcp-200..audit-phase16/steps/step5.out`).
--
-- REQUIRES SUPERUSER: the table + sequence are owned by `postgres`,
-- so the runner as `citymarket_user` cannot drop them. Apply
-- manually:
--
--     docker exec -u postgres citymarket-db psql -d citymarket_db \
--       -f migrations/116_pcp204_drop_legacy_schema_migrations.sql
--
-- Then run the migrator's --mark-applied so the file is recorded
-- in `app_migrations`:
--
--     npx tsx scripts/migrate.ts --mark-applied \
--       116_pcp204_drop_legacy_schema_migrations.sql
--
-- The marker checksum will be `manual:<sha256-of-this-file>` and
-- the drift detector will fire if anyone edits the file later.
--
-- IDEMPOTENT: every statement is `IF EXISTS`. Safe to re-run.
-- ══════════════════════════════════════════════════════════════

BEGIN;

DROP TABLE IF EXISTS public.schema_migrations;
DROP SEQUENCE IF EXISTS public.schema_migrations_id_seq;

COMMIT;