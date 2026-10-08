-- 086: make coupon `source` meaningful (admin / event / spin / referral).
--
-- * is_public        — listed on /profile/coupons + home «عروض لك». Personal
--                      codes (spin wins, referral codes) are never public.
-- * is_template      — spin / referral rows that are NOT redeemable
--                      themselves; they define the reward from which
--                      personal one-time codes are generated.
-- * user_id          — owner of a personal code (only they can redeem it).
-- * referrer_user_id — referral codes: the inviter (cannot self-redeem).
-- * template_id      — generated personal code → its template.
-- * event_name       — campaign name for `event` coupons.
-- * starts_at        — optional activation time.
-- * per_user_limit   — max redemptions per customer (NULL = unlimited).
-- * valid_days       — lifetime of codes generated from a template.
-- * spin_weight      — relative probability on the spin wheel (templates).

ALTER TABLE coupons
  ADD COLUMN IF NOT EXISTS title_ar         text,
  ADD COLUMN IF NOT EXISTS description_ar   text,
  ADD COLUMN IF NOT EXISTS is_public        boolean   NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_template      boolean   NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS user_id          uuid REFERENCES users(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS referrer_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS template_id      uuid REFERENCES coupons(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS event_name       text,
  ADD COLUMN IF NOT EXISTS starts_at        timestamp,
  ADD COLUMN IF NOT EXISTS per_user_limit   integer,
  ADD COLUMN IF NOT EXISTS valid_days       integer,
  ADD COLUMN IF NOT EXISTS spin_weight      integer   NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS created_at       timestamp NOT NULL DEFAULT now();

DO $$ BEGIN
  ALTER TABLE coupons ADD CONSTRAINT coupons_per_user_limit_pos CHECK (per_user_limit IS NULL OR per_user_limit > 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE coupons ADD CONSTRAINT coupons_valid_days_pos CHECK (valid_days IS NULL OR valid_days > 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE coupons ADD CONSTRAINT coupons_spin_weight_nonneg CHECK (spin_weight >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Codes are matched case-insensitively everywhere (UPPER(code) = $1).
CREATE UNIQUE INDEX IF NOT EXISTS uq_coupons_code_upper ON coupons (UPPER(code));
CREATE INDEX IF NOT EXISTS idx_coupons_user     ON coupons (user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_coupons_template ON coupons (source, is_template) WHERE is_template;
CREATE INDEX IF NOT EXISTS idx_orders_user_coupon ON orders (user_id, UPPER(coupon_code)) WHERE coupon_code IS NOT NULL;

-- Before 086 every active coupon was listed publicly; keep that for the
-- shared (admin / event) codes.
UPDATE coupons SET is_public = true
 WHERE source IN ('admin', 'event') AND user_id IS NULL AND NOT is_template;
