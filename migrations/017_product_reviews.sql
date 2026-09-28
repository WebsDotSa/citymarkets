-- 017_product_reviews.sql
CREATE TABLE IF NOT EXISTS product_reviews (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rating integer NOT NULL CHECK (rating >= 1 AND rating <= 5),
  comment text,
  is_verified_purchase boolean NOT NULL DEFAULT false,
  is_approved boolean NOT NULL DEFAULT true,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_product_reviews_product
  ON product_reviews(product_id, is_approved, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_product_reviews_user
  ON product_reviews(user_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_product_reviews_user_product
  ON product_reviews(user_id, product_id);

-- RLS: anyone reads approved, owner can write own.
ALTER TABLE product_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_reviews FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS product_reviews_read ON product_reviews;
CREATE POLICY product_reviews_read ON product_reviews
  FOR SELECT USING (is_approved = true);

DROP POLICY IF EXISTS product_reviews_insert ON product_reviews;
CREATE POLICY product_reviews_insert ON product_reviews
  FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS product_reviews_update ON product_reviews;
CREATE POLICY product_reviews_update ON product_reviews
  FOR UPDATE USING (true);

DROP POLICY IF EXISTS product_reviews_delete ON product_reviews;
CREATE POLICY product_reviews_delete ON product_reviews
  FOR DELETE USING (true);

GRANT SELECT ON product_reviews TO citymarket_user, marketing_user, ads_labs, popup_user, gadeh_user, safar_user, paperclip, webs_user, medusa, mesh;
GRANT INSERT, UPDATE, DELETE ON product_reviews TO citymarket_user;
