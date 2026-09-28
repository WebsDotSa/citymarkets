-- Offers feature: time-bound promotions with polymorphic scope.
-- Adds `offers` (master) and `offer_targets` (polymorphic junction).
-- The new view `products_unified_with_offers` (migration 040b) exposes
-- the best active offer per product so the storefront can render
-- offer badges, countdowns, and discounted prices without re-querying.
--
-- Backward-compatible with the legacy `discount_price` scalar — the
-- resolver in src/lib/offers.ts picks the better of the two.

BEGIN;

-- =========================================================================
-- offers: master table
-- =========================================================================
CREATE TABLE offers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title_ar        TEXT NOT NULL,
  title_en        TEXT,
  description_ar  TEXT,
  description_en  TEXT,
  image_url       TEXT NOT NULL,
  discount_type   TEXT NOT NULL CHECK (discount_type IN ('percentage', 'fixed')),
  discount_value  NUMERIC(10,2) NOT NULL CHECK (discount_value > 0),
  max_discount    NUMERIC(10,2),
  min_order       NUMERIC(10,2),
  starts_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ends_at         TIMESTAMPTZ NOT NULL,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  is_featured     BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  applies_to      TEXT NOT NULL DEFAULT 'mixed'
                  CHECK (applies_to IN ('catalog', 'vendor', 'mixed')),
  created_by      UUID REFERENCES admin_users(id) ON DELETE SET NULL,
  updated_by      UUID REFERENCES admin_users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT offers_window_valid CHECK (ends_at > starts_at),
  CONSTRAINT offers_discount_value_valid CHECK (
    (discount_type = 'percentage' AND discount_value <= 100)
    OR discount_type = 'fixed'
  )
);

CREATE INDEX idx_offers_active_window
  ON offers (is_active, starts_at, ends_at)
  WHERE is_active = TRUE;

CREATE INDEX idx_offers_featured
  ON offers (is_featured, sort_order)
  WHERE is_featured = TRUE AND is_active = TRUE;

CREATE INDEX idx_offers_ends_at ON offers (ends_at);

-- =========================================================================
-- offer_targets: polymorphic junction
-- One row per (offer, target). target_type='all' stores a single
-- sentinel row with target_id NULL.
-- =========================================================================
CREATE TABLE offer_targets (
  id          BIGSERIAL PRIMARY KEY,
  offer_id    UUID NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK (target_type IN ('product', 'category', 'vendor', 'all')),
  target_id   UUID,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT offer_targets_target_id_required CHECK (
    (target_type = 'all' AND target_id IS NULL)
    OR (target_type <> 'all' AND target_id IS NOT NULL)
  )
);

-- A given (offer, target_type, target_id) pair can only appear once.
-- COALESCE keeps the unique index defined for the 'all' NULL case.
CREATE UNIQUE INDEX uq_offer_targets_offer_target
  ON offer_targets (offer_id, target_type, COALESCE(target_id, '00000000-0000-0000-0000-000000000001'::uuid));

-- Reverse-lookup partial indexes per scope (the read path joins on these)
CREATE INDEX idx_offer_targets_product
  ON offer_targets (target_id) WHERE target_type = 'product';

CREATE INDEX idx_offer_targets_category
  ON offer_targets (target_id) WHERE target_type = 'category';

CREATE INDEX idx_offer_targets_vendor
  ON offer_targets (target_id) WHERE target_type = 'vendor';

CREATE INDEX idx_offer_targets_offer_id
  ON offer_targets (offer_id);

-- =========================================================================
-- updated_at trigger (match other admin-managed tables)
-- =========================================================================
CREATE OR REPLACE FUNCTION offers_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_offers_updated_at
  BEFORE UPDATE ON offers
  FOR EACH ROW EXECUTE FUNCTION offers_set_updated_at();

-- =========================================================================
-- Row Level Security (mirrors migrations 013/015)
-- =========================================================================
ALTER TABLE offers        ENABLE ROW LEVEL SECURITY;
ALTER TABLE offer_targets ENABLE ROW LEVEL SECURITY;

-- Public read of in-window, active offers (and their targets).
-- Admin writes go through the API layer (requireAdminApi) which runs
-- under the service role and bypasses RLS.
CREATE POLICY offers_public_read ON offers
  FOR SELECT
  USING (is_active = TRUE AND NOW() BETWEEN starts_at AND ends_at);

CREATE POLICY offer_targets_public_read ON offer_targets
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM offers o
      WHERE o.id = offer_targets.offer_id
        AND o.is_active = TRUE
        AND NOW() BETWEEN o.starts_at AND o.ends_at
    )
  );

ANALYZE offers;
ANALYZE offer_targets;

COMMIT;
