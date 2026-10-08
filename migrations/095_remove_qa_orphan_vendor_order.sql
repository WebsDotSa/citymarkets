-- ══════════════════════════════════════════════════════════════
-- 095 — Remove QA orphan vendor_order (P3 audit 2026-09-30)
--
-- vendor_orders row id='efe0f220-83b6-4988-8085-87689f9f848b' has
-- parent_order_id = NULL despite the FK constraint. The cause is
-- `ON DELETE SET NULL` — when the parent order was deleted, the FK
-- set parent_order_id to NULL (legitimate orphan).
--
-- However:
--   - order_number = 'QA-2026-16045' (QA prefix → test/QA data)
--   - 0 rows in vendor_order_items
--   - 0 refs from order_status_logs / admin_audit_logs / payment_events
--   - created 2026-07-22 (legacy)
--
-- Safe to drop. Confirmed by audit.
--
-- Forward-only.
-- ══════════════════════════════════════════════════════════════

BEGIN;

DELETE FROM vendor_orders
WHERE id = 'efe0f220-83b6-4988-8085-87689f9f848b';

COMMIT;
