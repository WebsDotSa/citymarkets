-- Orders, order items, and cart tables for production schema (UUID primary keys)
-- FIXED: Changed from SERIAL/INTEGER to UUID to match migration 001 and code expectations

-- 001 already created orders/cart/guest_cart with a minimal schema.
-- The CREATE TABLE IF NOT EXISTS below for those tables is a no-op on a
-- fresh DB, but the CREATE INDEX statements that follow need columns
-- that 001 did NOT add (guest_phone, coupon_code, payment_reference,
-- payment_method, payment_status). Add them up-front so the indexes
-- always have a column to point at. All ADD COLUMN IF NOT EXISTS are
-- safe to re-run on production where the columns already exist.

ALTER TABLE orders ADD COLUMN IF NOT EXISTS guest_name    TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS guest_phone   VARCHAR(32);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS guest_city    TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS guest_district TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS guest_street  TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS guest_building TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS coupon_code   VARCHAR(50);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_reference VARCHAR(128);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_method    VARCHAR(32);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_status    VARCHAR(32) DEFAULT 'unpaid';

CREATE TABLE IF NOT EXISTS cart (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_cart_user ON cart(user_id);

CREATE TABLE IF NOT EXISTS guest_cart (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id VARCHAR(128) NOT NULL,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (session_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_guest_cart_session ON guest_cart(session_id);

CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  address_id UUID REFERENCES addresses(id) ON DELETE SET NULL,
  guest_name TEXT,
  guest_phone VARCHAR(32),
  guest_city TEXT,
  guest_district TEXT,
  guest_street TEXT,
  guest_building TEXT,
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  subtotal NUMERIC(10, 2) NOT NULL DEFAULT 0,
  delivery_fee NUMERIC(10, 2) NOT NULL DEFAULT 0,
  service_fee NUMERIC(10, 2) NOT NULL DEFAULT 0,
  discount NUMERIC(10, 2) NOT NULL DEFAULT 0,
  total NUMERIC(10, 2) NOT NULL DEFAULT 0,
  notes TEXT,
  internal_notes TEXT,
  coupon_code VARCHAR(50),
  payment_method VARCHAR(32),
  payment_reference VARCHAR(128),
  payment_status VARCHAR(32) DEFAULT 'unpaid',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_payment_ref ON orders(payment_reference);

CREATE TABLE IF NOT EXISTS order_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  qty INTEGER NOT NULL CHECK (qty > 0),
  unit_price NUMERIC(10, 2) NOT NULL,
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);

-- Updated cart/guest_cart triggers
CREATE OR REPLACE FUNCTION update_cart_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Guest cart trigger needs its own function because the original code
-- referenced update_guest_cart_updated_at() which was never created —
-- the cart trigger function does not match. Both functions share the
-- same body but live as separate PL/pgSQL objects so the trigger
-- lookups succeed independently.
CREATE OR REPLACE FUNCTION update_guest_cart_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_cart_updated_at ON cart;
CREATE TRIGGER update_cart_updated_at BEFORE UPDATE ON cart
  FOR EACH ROW EXECUTE FUNCTION update_cart_updated_at();

DROP TRIGGER IF EXISTS update_guest_cart_updated_at ON guest_cart;
CREATE TRIGGER update_guest_cart_updated_at BEFORE UPDATE ON guest_cart
  FOR EACH ROW EXECUTE FUNCTION update_guest_cart_updated_at();
