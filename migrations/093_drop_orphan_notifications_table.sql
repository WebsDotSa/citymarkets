-- ══════════════════════════════════════════════════════════════
-- 093 — Drop orphan `notifications` table (P2 audit 2026-09-30)
--
-- Audit (2026-09-30): the `notifications` table has been empty since
-- 2024 (0 rows, 0 INSERT statements anywhere in src/). Two distinct
-- "notifications" features co-exist:
--
--   1. Admin notifications (/api/admin/notifications, /admin/notifications)
--      — these are SYNTHESIZED on the fly from `orders` + `products_unified`
--        and `products_unified` low-stock queries. The read-state for each
--        synthetic id is persisted in `admin_notification_reads`.
--      — does NOT use `notifications` table.
--
--   2. Customer-side notifications — the legacy app-side notification
--      feed that nobody ever wired up. No INSERT, no consumer.
--
-- Pre-flight (verified by audit script):
--   - 0 rows in `notifications`.
--   - 63 references in src/ but ALL are in /api/admin/notifications
--     and admin UI components that already bypass the table and use
--     admin_notification_reads instead.
--   - No INSERT INTO notifications statements in src/ or migrations/.
--   - RLS policies: none (DENY ALL row security would block even reads
--     from the admin app via the connection pool).
--
-- Forward-only. If a future feature wants to add customer-side
-- notifications, create a new migration with a clear name (e.g.
-- `customer_notifications`) and wire it through RLS.
-- ══════════════════════════════════════════════════════════════

BEGIN;

DROP TABLE IF EXISTS notifications;

COMMIT;
