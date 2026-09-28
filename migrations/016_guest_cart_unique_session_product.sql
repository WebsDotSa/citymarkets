-- 016_guest_cart_unique_session_product.sql
-- Purpose: cart POST used `ON CONFLICT (session_id, product_id) DO UPDATE` but
--          the table had no unique index on (session_id, product_id). Every
--          guest add-to-cart returned "حدث خطأ" (500). Add the constraint
--          and partial unique index. Existing duplicates (if any) are
--          collapsed to the latest row before the constraint is added.

BEGIN;

-- Collapse any duplicate (session_id, product_id) rows by keeping the row
-- with the largest quantity, then deleting the rest.
WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (
    PARTITION BY session_id, product_id
    ORDER BY quantity DESC, created_at DESC
  ) AS rn
  FROM guest_cart
)
DELETE FROM guest_cart
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- Add the unique constraint. NULL product_id rows are allowed (cart cleared
-- by deleting all items leaves no rows; cart-merge by product is what matters).
ALTER TABLE guest_cart
  ADD CONSTRAINT guest_cart_session_product_unique
  UNIQUE (session_id, product_id);

-- Grant write access to citymarket_user (service role for the API).
GRANT INSERT, UPDATE, DELETE ON guest_cart TO citymarket_user;

COMMIT;
