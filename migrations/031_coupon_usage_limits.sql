-- 031: coupon usage limits
-- The orders route validated `max_uses`/`used_count` against the coupons table,
-- but those columns were never created (they only existed on vendor_coupons).
-- Every checkout that carried a coupon code failed with a SQL error.

ALTER TABLE coupons
  ADD COLUMN IF NOT EXISTS max_uses INT,
  ADD COLUMN IF NOT EXISTS used_count INT NOT NULL DEFAULT 0;

-- Guard against a race between concurrent checkouts redeeming the last use.
ALTER TABLE coupons
  DROP CONSTRAINT IF EXISTS coupons_used_count_non_negative;
ALTER TABLE coupons
  ADD CONSTRAINT coupons_used_count_non_negative CHECK (used_count >= 0);

CREATE INDEX IF NOT EXISTS idx_coupons_code_upper ON coupons (UPPER(code));
