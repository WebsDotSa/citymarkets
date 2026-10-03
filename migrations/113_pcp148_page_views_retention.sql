-- ══════════════════════════════════════════════════════════════
-- 113_pcp148_page_views_retention.sql
-- PCP-148: page_views is append-only analytics at ~120 rows/day.
-- Today ~5 MB / 7,796 rows / 7 indexes; no retention policy.
-- Add a SQL function that returns the retention window (90 days)
-- and a `page_views_recent` view that applies it, so the worker
-- (scripts/worker.ts → cleanup-old-page-views) can call the same
-- predicate in a single DELETE.
--
-- pg_cron is NOT available in this cluster (verified via
-- pg_extension: plpgsql, pgcrypto, uuid-ossp, vector). The
-- scheduler therefore lives in scripts/worker.ts on a 24h cadence,
-- mirroring cleanupOldNotifications.
--
-- The retention window lives in the SQL function (not a literal in
-- the DELETE) so future tuning is a one-line migration, not a code
-- change.
--
-- IDEMPOTENT: every statement is CREATE OR REPLACE / IF NOT EXISTS
-- / ON CONFLICT. Safe to re-run.
-- ══════════════════════════════════════════════════════════════

BEGIN;

-- 1) Configurable retention window. Single source of truth for the
--    cutoff; the worker reads this so the SQL function and the
--    DELETE stay in sync if we ever change the window.
CREATE OR REPLACE FUNCTION public.page_views_retention_days()
RETURNS integer
LANGUAGE sql
STABLE
AS $$
  SELECT 90;
$$;

-- 2) Convenience view: rows within the retention window. The worker
--    uses the equivalent predicate in its DELETE, but the view
--    makes it visible to ad-hoc operators (and to future analytics
--    queries that want to honour the policy by default).
CREATE OR REPLACE VIEW public.page_views_recent AS
SELECT *
FROM public.page_views
WHERE occurred_at >= NOW() - (public.page_views_retention_days() || ' days')::interval;

-- 3) Audit marker so operators can confirm the migration ran.
--    Matches the convention used in 111_pcp127 and 112_pcp136.
INSERT INTO _migration_guards (guard_name, active, created_at)
VALUES (
  'pcp148_page_views_retention',
  TRUE,
  NOW()
)
ON CONFLICT (guard_name) DO UPDATE
  SET active = EXCLUDED.active,
      created_at = EXCLUDED.created_at;

COMMIT;
