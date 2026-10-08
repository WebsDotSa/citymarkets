-- ══════════════════════════════════════════════════════════════
-- 112_pcp136_unindexed_fks.sql
-- PCP-136: 5 foreign-key columns had no first-column btree index.
--
-- Detection query (used by the audit):
--   WITH fk AS (...pg_constraint WHERE contype='f'...),
--        first_idx AS (...pg_index first column...)
--   SELECT fk.tbl, fk.fk_col, fk.conname
--   FROM fk LEFT JOIN first_idx ON first_idx.tbl=fk.tbl
--                                   AND first_idx.col=fk.fk_col
--   WHERE first_idx.index_name IS NULL;
--
-- After 102_add_missing_fk_indexes.sql covered 16 FKs in the same
-- shape, an authoritative re-run on 2026-10-02 (PCP-116 phase 14)
-- surfaced 5 more. All three target tables are empty or near-empty
-- today, but every UPDATE/DELETE on the parent rows (orders, users,
-- products, payment_events) currently does a sequential scan of
-- the child table to verify the FK. That scales linearly with row
-- count and is the exact failure mode migration 102 was meant to
-- prevent.
--
-- Affected FKs (covering_index column empty):
--   orders_refunds.payment_event_id      → payment_events(id)  ON DELETE SET NULL
--   orders_refunds.requested_by_user_id  → users(id)           ON DELETE SET NULL
--   refund_requests.approved_by_user_id  → users(id)           ON DELETE SET NULL
--   refund_requests.requested_by_user_id → users(id)           ON DELETE SET NULL
--   wishlist_items.product_id           → vendor_products(id) ON DELETE RESTRICT
--
-- wishlist_items.product_id is the most impactful — it's the only
-- RESTRICT one, meaning a single wishlist row blocks product deletion
-- via seq-scan lookup. vendor_products deletes already run during
-- vendor offboarding.
--
-- REQUIRES SUPERUSER: refund_requests and wishlist_items are owned
-- by `postgres`, not by `citymarket_user`. The runner as
-- citymarket_user cannot CREATE INDEX on them — same constraint as
-- migration 111. Apply manually as postgres:
--   docker exec -i citymarket-db psql -U postgres -d citymarket_db \
--     < migrations/112_pcp136_unindexed_fks.sql
-- and then record in app_migrations via:
--   DATABASE_PASSWORD=... npx tsx scripts/migrate.ts \
--     --from 112_pcp136_unindexed_fks.sql --mark-applied
--
-- IF NOT EXISTS makes every statement safe to re-run.
-- ══════════════════════════════════════════════════════════════

BEGIN;

-- orders_refunds.payment_event_id → payment_events(id)
CREATE INDEX IF NOT EXISTS idx_orders_refunds_payment_event_id
  ON public.orders_refunds (payment_event_id);

-- orders_refunds.requested_by_user_id → users(id)
CREATE INDEX IF NOT EXISTS idx_orders_refunds_requested_by_user_id
  ON public.orders_refunds (requested_by_user_id);

-- refund_requests.approved_by_user_id → users(id)
CREATE INDEX IF NOT EXISTS idx_refund_requests_approved_by_user_id
  ON public.refund_requests (approved_by_user_id);

-- refund_requests.requested_by_user_id → users(id)
CREATE INDEX IF NOT EXISTS idx_refund_requests_requested_by_user_id
  ON public.refund_requests (requested_by_user_id);

-- wishlist_items.product_id → vendor_products(id)
CREATE INDEX IF NOT EXISTS idx_wishlist_items_product_id
  ON public.wishlist_items (product_id);

-- Audit marker so operators can confirm the migration ran
-- (matches the convention from 111_pcp127_add_products_created_at_index.sql).
INSERT INTO _migration_guards (guard_name, active, created_at)
VALUES (
  'pcp136_unindexed_fks',
  TRUE,
  NOW()
)
ON CONFLICT (guard_name) DO UPDATE
  SET active = EXCLUDED.active,
      created_at = EXCLUDED.created_at;

COMMIT;