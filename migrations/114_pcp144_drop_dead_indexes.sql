-- 114 — PCP-144 — drop 5 dead indexes surfaced by Phase 15 spike 002.
--
-- Each of these indexes has idx_scan = 0 in pg_stat_user_indexes AND is
-- fully subsumed by a wider index on the same table. Pure write-amp
-- waste: every INSERT/UPDATE on the parent table has to maintain both
-- the dead and the kept index.
--
--   Index                                Size   Subsumed by
--   -----------------------------------  ----   ----------------------------------
--   idx_addresses_user                    16 kB idx_addresses_user_id (PCP-136)
--   idx_addresses_user_default_full       16 kB idx_addresses_user_default (partial)
--   idx_orders_user                       16 kB idx_orders_user_id (PCP-136)
--   idx_orders_user_created               16 kB idx_orders_user_status_date
--   idx_admin_notification_reads_admin    8 kB idx_admin_notification_reads_lookup
--
--   Total: 5 indexes, 72 kB. The write-amp saving matters more than
--   the bytes saved — orders and cart are the hottest write paths.
--
-- Safety:
--   * IF EXISTS on every DROP (re-running this migration is a no-op).
--   * DROP INDEX CONCURRENTLY is not used because we are inside a
--     transaction; for production rollout run each DROP separately
--     in a non-transactional context, or accept the brief ACCESS
--     EXCLUSIVE lock (these are 16-32 kB tables, the lock is instant).
--   * Owner is `postgres` (matches Phase 14 pattern from migration 112).
--
-- Reference:
--   spikes/002-duplicate-or-redundant-indexes/README.md
--   spikes/002-duplicate-or-redundant-indexes/query.sql
--   Phase 15 report audit-output/pcp-101-phase15-citymarkets-audit-report.md

BEGIN;

DROP INDEX IF EXISTS public.idx_addresses_user;
DROP INDEX IF EXISTS public.idx_addresses_user_default_full;
DROP INDEX IF EXISTS public.idx_orders_user;
DROP INDEX IF EXISTS public.idx_orders_user_created;
DROP INDEX IF EXISTS public.idx_admin_notification_reads_admin;

-- Audit marker (Phase 14/15 convention from migrations 111/112/113).
INSERT INTO _migration_guards (guard_name, active, created_at)
  VALUES ('pcp144_drop_dead_indexes', TRUE, NOW())
  ON CONFLICT (guard_name) DO UPDATE
    SET active = EXCLUDED.active,
        created_at = EXCLUDED.created_at;

COMMIT;
