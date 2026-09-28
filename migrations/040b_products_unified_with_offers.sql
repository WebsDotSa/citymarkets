-- products_unified_with_offers: extends products_unified with the best
-- active offer per product. Kept as a separate view so the existing
-- `products_unified` read path stays fast; endpoints that need offer
-- data opt in by selecting from this view.
--
-- The LATERAL subquery caps candidate offers at 5 to keep the join
-- bounded; the application-layer resolver (src/lib/offers.ts) picks
-- the winner using absolute savings, which is non-trivial in SQL.

BEGIN;

CREATE OR REPLACE VIEW products_unified_with_offers AS
SELECT
  p.*,
  best_offer.id             AS active_offer_id,
  best_offer.title_ar       AS active_offer_title_ar,
  best_offer.discount_type  AS active_offer_type,
  best_offer.discount_value AS active_offer_value,
  best_offer.max_discount   AS active_offer_max_discount,
  best_offer.min_order      AS active_offer_min_order,
  best_offer.starts_at      AS active_offer_starts_at,
  best_offer.ends_at        AS active_offer_ends_at
FROM products_unified p
LEFT JOIN LATERAL (
  SELECT o.*
  FROM offers o
  JOIN offer_targets ot ON ot.offer_id = o.id
  WHERE o.is_active = TRUE
    AND NOW() BETWEEN o.starts_at AND o.ends_at
    AND (
         (ot.target_type = 'product'  AND ot.target_id = p.id)
      OR (ot.target_type = 'category' AND ot.target_id = p.category_id)
      OR (ot.target_type = 'vendor'   AND ot.target_id = p.vendor_id)
      OR (ot.target_type = 'all')
    )
  ORDER BY o.discount_value DESC
  LIMIT 5
) best_offer ON TRUE;

COMMIT;
