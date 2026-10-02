-- 059_vendor_applications.sql
-- Public-facing /vendors/register form: prospective merchants submit
-- business + owner details. Admin reviews applications in
--   /admin/(dashboard)/vendor-applications
-- and on approval the API (POST /api/admin/vendor-applications/[id]/approve)
-- atomically:
--   1. inserts a row into `vendors`
--   2. inserts a row into `vendor_staff` with role='owner' so the
--      merchant can sign in at /vendor/<slug>/admin/login
--   3. inserts default `vendor_settings` (delivery_mode='shared',
--      min_order_amount=0, accepts_cod=TRUE, accepts_online_payment=TRUE)
--
-- Status lifecycle:
--   new        → submitted, awaiting admin action
--   approved   → vendor row + owner row + settings inserted
--   rejected   → admin closed it out with a reason (stored in admin_notes)
--
-- The applicant NEVER sees the password again after submission — it's
-- hashed at submission time and the plaintext is discarded. The admin
-- can rotate the password from /admin/vendors at any time.

BEGIN;

CREATE TABLE IF NOT EXISTS vendor_applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Business / storefront
  business_name_ar TEXT NOT NULL,
  business_name_en TEXT,
  vendor_type TEXT NOT NULL CHECK (vendor_type IN (
    'food_beverage', 'fashion', 'gifts', 'electronics', 'services'
  )),
  description_ar TEXT,
  description_en TEXT,

  -- Owner / operator
  owner_full_name TEXT NOT NULL,
  owner_email TEXT NOT NULL,
  owner_password_hash TEXT NOT NULL,
  owner_phone TEXT NOT NULL,
  owner_whatsapp TEXT,

  -- Location / contact
  address_ar TEXT,
  pickup_lat DECIMAL(10,7),
  pickup_lng DECIMAL(10,7),
  city TEXT,

  -- Initial operational preferences (admin can change later)
  delivery_mode TEXT NOT NULL DEFAULT 'shared'
    CHECK (delivery_mode IN ('shared', 'own_courier', 'pickup_only')),
  accepts_cod BOOLEAN NOT NULL DEFAULT TRUE,
  accepts_online_payment BOOLEAN NOT NULL DEFAULT TRUE,

  -- Optional supporting evidence (commercial registration, ID, menu…)
  documents JSONB NOT NULL DEFAULT '[]'::jsonb,

  -- Lifecycle
  status TEXT NOT NULL DEFAULT 'new'
    CHECK (status IN ('new', 'approved', 'rejected')),
  admin_notes TEXT,
  rejection_reason TEXT,
  reviewed_by UUID REFERENCES admin_users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  approved_vendor_id UUID REFERENCES vendors(id) ON DELETE SET NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vendor_applications_status
  ON vendor_applications(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_vendor_applications_created_at
  ON vendor_applications(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_vendor_applications_email
  ON vendor_applications(LOWER(owner_email));

-- Partial unique index: same owner email cannot have two OPEN
-- applications at the same time. After approval/rejection a new
-- application is allowed (e.g. a different business, or a re-apply
-- after admin rejection). Without WHERE clause a rejected email
-- would be permanently blocked from reapplying.
CREATE UNIQUE INDEX IF NOT EXISTS uq_vendor_applications_open_email
  ON vendor_applications(LOWER(owner_email))
  WHERE status = 'new';

-- updated_at trigger (matches the pattern from 045 / abandoned_carts)
CREATE OR REPLACE FUNCTION vendor_applications_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_vendor_applications_updated_at ON vendor_applications;
CREATE TRIGGER trg_vendor_applications_updated_at
  BEFORE UPDATE ON vendor_applications
  FOR EACH ROW EXECUTE FUNCTION vendor_applications_set_updated_at();

-- RLS: anonymous storefront visitors may INSERT (the registration form
-- must work without login). Reads come through the admin API which uses
-- the service role (BYPASSRLS), so we don't need a public SELECT.
ALTER TABLE vendor_applications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS vendor_applications_public_insert ON vendor_applications;
CREATE POLICY vendor_applications_public_insert ON vendor_applications
  FOR INSERT
  WITH CHECK (true);

GRANT ALL ON vendor_applications TO citymarket_user;

COMMIT;