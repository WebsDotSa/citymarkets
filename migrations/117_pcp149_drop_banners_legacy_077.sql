-- ══════════════════════════════════════════════════════════════
-- 117_pcp149_drop_banners_legacy_077.sql
-- PCP-149: drop orphan table `public.banners_legacy_077`.
--
-- Discovered during the Phase 15 RLS sweep (spike 006). The table
-- exists on the live DB (48 kB, 2 rows, owned by `postgres`, RLS
-- enabled) but no migration ever creates it — only migration 108
-- (`108_rls_defensive_policies_all_tables.sql` line 39) adds a
-- defensive RLS policy for the name, which means the policy was
-- attached to a table that should not have existed in the first
-- place.
--
-- The `_077` suffix strongly suggests this is a backup copy left
-- behind by migration 077 (`077_drop_banners_table.sql`):
--
--     077_drop_banners_table.sql only drops the `banners` table and
--     `banner_link_type_enum` type. A prior `banners_legacy_077`
--     backup was apparently renamed off, never deleted.
--
-- No app code references this table (grep across `src/` returns
-- nothing). Removing it removes:
--   * a 48 kB orphan in pg_class
--   * the `banners_legacy_077_app_all` RLS policy (auto-cascaded
--     with the table, so migration 108's defensive sweep no longer
--     needs to mention it)
--   * one row in the future RLS-policies audit tables
--
-- REQUIRES SUPERUSER: the table is owned by `postgres`, not by
-- `citymarket_user`, so the runner as citymarket_user cannot drop
-- it. Apply manually as postgres:
--
--   docker exec -i citymarket-db psql -U postgres -d citymarket_db \
--     < migrations/117_pcp149_drop_banners_legacy_077.sql
--
-- and then record in app_migrations via:
--
--   DATABASE_PASSWORD=... npx tsx scripts/migrate.ts \
--     --from 117_pcp149_drop_banners_legacy_077.sql --mark-applied
--
-- IF EXISTS makes the statement safe to re-run; the only side
-- effect on a database that already dropped the table is the
-- guard-row upsert at the bottom.
-- ══════════════════════════════════════════════════════════════

BEGIN;

DROP TABLE IF EXISTS public.banners_legacy_077;

-- Audit marker so operators can confirm the migration ran
-- (matches the convention from 111_pcp127_add_products_created_at_index.sql
-- and 112_pcp136_unindexed_fks.sql).
INSERT INTO _migration_guards (guard_name, active, created_at)
VALUES (
  'pcp149_drop_banners_legacy_077',
  TRUE,
  NOW()
)
ON CONFLICT (guard_name) DO UPDATE
  SET active = EXCLUDED.active,
      created_at = EXCLUDED.created_at;

COMMIT;
