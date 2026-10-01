-- 087: reconcile schema ↔ application contract mismatches found in the
-- 2026-09-30 API / backend / Postgres consistency audit.
--
-- Every statement is conditional / idempotent so the file applies on
-- both shapes that exist in the wild:
--   * production  — drifted (admin_users.role is varchar, audit
--                   entity_id is uuid, payment_method defaults to 'cash')
--   * fresh chain — 001→086 (admin_users.role is admin_role_enum)
--
-- 1. contact_messages
--    POST /api/v1/contact inserts into this table but no migration ever
--    created it, so every contact-form submission was silently dropped.
--
-- 2. vendor_applications.vendor_type
--    059 allowed 5 types; the application form validates against the 23
--    VENDOR_TYPES (src/lib/catalog/vendors.ts), same list as
--    vendors_vendor_type_check (063 + 068). 18 of the 23 options raised
--    23514 → HTTP 500.
--
-- 3. admin_users.role
--    003 created admin_role_enum (super_admin, admin, manager, support).
--    The dashboard creates `editor`, `viewer` and `delivery_driver`
--    (src/lib/admin-types.ts) — production already stores those because
--    its column is varchar. Converge both shapes on varchar + CHECK with
--    the union the API validator accepts (adminStaffCreateSchema).
--
-- 4. admin_audit_logs.entity_id
--    logAdminAction() passes `string | number` ids (coupon codes,
--    setting keys, …). Production's column is uuid, so those audit rows
--    were rejected. The fresh chain already uses text.
--
-- 5. orders.payment_method default
--    Production defaults to the legacy token 'cash', which is not a
--    canonical payment method (src/lib/payments/payment-methods.ts).
--    The fresh chain has no default; the checkout always sets it.
--
-- 6. guest_cart.updated_at, loyalty_transactions.reason / balance_after
--    Created by early migrations (001 / 006 / 021) that production
--    skipped via legacy schema_migrations tracking. The code writes them:
--    PATCH /api/v1/cart (guest quantity change) and the spin-wheel points
--    prize both failed with "column does not exist".

BEGIN;

-- 1 ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS contact_messages (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  phone       TEXT NOT NULL,
  email       TEXT,
  subject     TEXT,
  message     TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_contact_messages_created
  ON contact_messages (created_at DESC);

-- 2 ─────────────────────────────────────────────────────────────────
ALTER TABLE vendor_applications
  DROP CONSTRAINT IF EXISTS vendor_applications_vendor_type_check;

ALTER TABLE vendor_applications
  ADD CONSTRAINT vendor_applications_vendor_type_check CHECK (vendor_type IN (
    'food_beverage', 'fashion', 'gifts', 'electronics', 'services',
    'grocery_supermarket', 'restaurant_cafe', 'sweets_bakery',
    'pharmacy_health', 'beauty_cosmetics', 'flowers_plants',
    'books_stationery', 'sports_fitness',
    'home_appliances', 'furniture_home', 'jewelry_watches', 'cars_auto',
    'pets_animals', 'kids_babies', 'music_instruments', 'tools_industrial',
    'travel_tourism', 'real_estate'
  ));

-- 3 ─────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'admin_users'
       AND column_name = 'role'
       AND udt_name = 'admin_role_enum'
  ) THEN
    ALTER TABLE admin_users ALTER COLUMN role DROP DEFAULT;
    ALTER TABLE admin_users ALTER COLUMN role TYPE VARCHAR(32) USING role::text;
    ALTER TABLE admin_users ALTER COLUMN role SET DEFAULT 'admin';
  END IF;
END $$;

ALTER TABLE admin_users DROP CONSTRAINT IF EXISTS admin_users_role_check;
ALTER TABLE admin_users
  ADD CONSTRAINT admin_users_role_check CHECK (role IN (
    'super_admin', 'admin', 'manager', 'support',
    'editor', 'viewer', 'delivery_driver'
  ));

-- The enum is only dropped when nothing else still depends on it.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'admin_role_enum')
     AND NOT EXISTS (
       SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND udt_name = 'admin_role_enum'
     ) THEN
    DROP TYPE admin_role_enum;
  END IF;
END $$;

-- 4 ─────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'admin_audit_logs'
       AND column_name = 'entity_id'
       AND data_type = 'uuid'
  ) THEN
    ALTER TABLE admin_audit_logs
      ALTER COLUMN entity_id TYPE TEXT USING entity_id::text;
  END IF;
END $$;

-- 5 ─────────────────────────────────────────────────────────────────
ALTER TABLE orders ALTER COLUMN payment_method DROP DEFAULT;

-- 6 ─────────────────────────────────────────────────────────────────
ALTER TABLE guest_cart
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT NOW();
CREATE INDEX IF NOT EXISTS idx_guest_cart_session_updated
  ON guest_cart (session_id, updated_at DESC);

ALTER TABLE loyalty_transactions
  ADD COLUMN IF NOT EXISTS reason TEXT,
  ADD COLUMN IF NOT EXISTS balance_after INTEGER;
CREATE INDEX IF NOT EXISTS idx_loyalty_tx_reason
  ON loyalty_transactions (reason);

COMMIT;
