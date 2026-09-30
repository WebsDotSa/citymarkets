-- ════════════════════════════════════════════════════════════════════════════
-- P2-4 (full-system audit 2026-09-30) — drop orphaned `reviews` table
-- ════════════════════════════════════════════════════════════════════════════
--
-- Migration 001 created a `reviews` table for order-level reviews (driver
-- + store rating, one row per order via UNIQUE(order_id)). Migration 017
-- then introduced `product_reviews` for product-level reviews and the
-- application pivoted: every active route — admin/reviews, v1/reviews,
-- v1/products — reads/writes `product_reviews`. The `createReviewSchema`
-- Zod validator in src/lib/validation/order.ts was defined for the
-- original `reviews` shape but is never imported by any route, so the
-- order-level review write path has been dead since migration 017.
--
-- Audit plan labelled the tables the opposite way ("product_reviews
-- ميت, reviews حيّ"), but live usage shows the reverse: `product_reviews`
-- has 8 query sites across admin/reviews, v1/reviews, v1/products; the
-- bare `reviews` table has 0. Dropping the wrong table would break the
-- storefront review surface, so this migration targets the actual dead
-- one (`reviews`).
--
-- Safety: empty-table pre-check, mirroring the migration 077 banner-drop
-- pattern. Idempotent: re-running on a database that already had this
-- drop applied is a no-op.

BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_name = 'reviews'
       AND table_type = 'BASE TABLE'
  ) THEN
    -- product_reviews is a separate table — its existence does NOT
    -- block dropping the bare `reviews` table. Only this one.
    IF EXISTS (SELECT 1 FROM reviews LIMIT 1) THEN
      RAISE EXCEPTION
        'reviews (order-level) still holds rows (% found); refusing to drop. ' ||
        'Either migrate to product_reviews first or run with care.',
        (SELECT COUNT(*) FROM reviews);
    END IF;
    DROP TABLE reviews;
    RAISE NOTICE 'P2-4 cleanup: dropped orphaned reviews table';
  ELSE
    RAISE NOTICE 'P2-4 cleanup: reviews table already absent';
  END IF;
END $$;

COMMIT;