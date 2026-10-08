-- ══════════════════════════════════════════════════════════════
-- 102 — Add missing FK indexes (P1 from random audit 2026-09-30)
--
-- 16 foreign-key columns were missing a matching btree index,
-- causing sequential scans on JOIN/UPDATE/DELETE through these
-- columns. Each CREATE INDEX is wrapped in IF NOT EXISTS so the
-- migration is idempotent.
--
-- Audit: see /root/.hermes/cache/scratch/random-audit-2026-09-30.md
-- ══════════════════════════════════════════════════════════════

BEGIN;

CREATE INDEX IF NOT EXISTS idx_abandoned_carts_recovered_order_id
  ON abandoned_carts (recovered_order_id);

CREATE INDEX IF NOT EXISTS idx_analytics_events_product_id
  ON analytics_events (product_id);

CREATE INDEX IF NOT EXISTS idx_broadcasts_template_id
  ON broadcasts (template_id);

CREATE INDEX IF NOT EXISTS idx_coupons_referrer_user_id
  ON coupons (referrer_user_id);

CREATE INDEX IF NOT EXISTS idx_coupons_template_id
  ON coupons (template_id);

CREATE INDEX IF NOT EXISTS idx_direct_order_items_product_id
  ON direct_order_items (product_id);

CREATE INDEX IF NOT EXISTS idx_direct_order_items_resolved_by_admin_id
  ON direct_order_items (resolved_by_admin_id);

CREATE INDEX IF NOT EXISTS idx_direct_order_items_resolved_product_id
  ON direct_order_items (resolved_product_id);

CREATE INDEX IF NOT EXISTS idx_direct_order_messages_sender_admin_id
  ON direct_order_messages (sender_admin_id);

CREATE INDEX IF NOT EXISTS idx_home_layouts_updated_by
  ON home_layouts (updated_by);

CREATE INDEX IF NOT EXISTS idx_job_applications_reviewed_by
  ON job_applications (reviewed_by);

CREATE INDEX IF NOT EXISTS idx_offers_created_by
  ON offers (created_by);

CREATE INDEX IF NOT EXISTS idx_offers_updated_by
  ON offers (updated_by);

CREATE INDEX IF NOT EXISTS idx_spin_results_coupon_id
  ON spin_results (coupon_id);

CREATE INDEX IF NOT EXISTS idx_vendor_applications_approved_vendor_id
  ON vendor_applications (approved_vendor_id);

CREATE INDEX IF NOT EXISTS idx_vendor_applications_reviewed_by
  ON vendor_applications (reviewed_by);

COMMIT;
