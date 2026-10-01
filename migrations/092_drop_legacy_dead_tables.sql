-- ══════════════════════════════════════════════════════════════
-- 092 — Drop legacy dead tables (P2 audit 2026-09-30)
--
-- Six tables were found empty + zero code references:
--
--   1. admin_vendor_access       — RBAC matrix stub, never wired up
--                                    (see src/lib/admin-types.ts: ROLE_PERMISSIONS
--                                     covers everything instead)
--   2. home_inventory            — pre-MVP idea, never used
--   3. payment_events_legacy_007 — explicit legacy table from migration 007;
--                                    active replacement is `payment_events`
--   4. saved_lists               — old "favorites list" feature, replaced by
--                                    `wishlist_items`
--   5. wallet_transactions       — wallet feature never implemented
--   6. native_push_dispatch_log  — replaced by app-level logging; see
--                                    `src/lib/native-push/log.ts` if needed
--
-- Pre-flight (verified by audit script):
--   - All six tables have 0 rows.
--   - No source file under src/ references any of them (except the
--     drop migration itself).
--   - No view or function under public references them.
--   - No FK constraint in or out of them.
--
-- Forward-only. If anything ever references these names, the DROP will
-- fail loudly — that's the intended behaviour.
-- ══════════════════════════════════════════════════════════════

BEGIN;

DROP TABLE IF EXISTS admin_vendor_access;
DROP TABLE IF EXISTS home_inventory;
DROP TABLE IF EXISTS payment_events_legacy_007;
DROP TABLE IF EXISTS saved_lists;
DROP TABLE IF EXISTS wallet_transactions;
DROP TABLE IF EXISTS native_push_dispatch_log;

COMMIT;
