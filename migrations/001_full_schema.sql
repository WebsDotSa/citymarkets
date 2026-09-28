-- ═══════════════════════════════════════════════════════════
-- أسواقシティ المركزية - Full Database Migration
-- 18 Tables + Enums + Indexes + pgvector
-- ═══════════════════════════════════════════════════════════

-- Enable extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ══════════════════════════════════
-- ENUMS
-- ══════════════════════════════════
DO $$ BEGIN

  -- Loyalty tiers
  CREATE TYPE loyalty_tier_enum AS ENUM ('bronze', 'silver', 'gold', 'platinum');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE order_status_enum AS ENUM ('pending', 'confirmed', 'shopping', 'on_the_way', 'delivered', 'cancelled');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE order_type_enum AS ENUM ('catalog', 'direct');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE driver_status_enum AS ENUM ('available', 'busy', 'offline');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE coupon_type_enum AS ENUM ('percentage', 'fixed', 'free_delivery');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE coupon_source_enum AS ENUM ('spin', 'admin', 'event', 'referral');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE notification_type_enum AS ENUM ('order', 'coupon', 'promotion', 'system');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE banner_link_type_enum AS ENUM ('product', 'category', 'external', 'none');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE loyalty_tx_type_enum AS ENUM ('earn', 'redeem', 'adjust');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ══════════════════════════════════
-- 1. USERS
-- ══════════════════════════════════
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  phone VARCHAR(20) NOT NULL UNIQUE,
  name TEXT,
  email TEXT,
  avatar_url TEXT,
  loyalty_points INTEGER DEFAULT 0 NOT NULL,
  loyalty_tier loyalty_tier_enum DEFAULT 'bronze' NOT NULL,
  spin_count_today INTEGER DEFAULT 0 NOT NULL,
  last_spin_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMP DEFAULT NOW() NOT NULL
);

-- ══════════════════════════════════
-- 2. ADDRESSES
-- ══════════════════════════════════
CREATE TABLE IF NOT EXISTS addresses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  lat DECIMAL(10,7) NOT NULL,
  lng DECIMAL(10,7) NOT NULL,
  address_text TEXT NOT NULL,
  is_default BOOLEAN DEFAULT false NOT NULL,
  created_at TIMESTAMP DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_addresses_user ON addresses(user_id);

-- ══════════════════════════════════
-- 3. CATEGORIES
-- ══════════════════════════════════
CREATE TABLE IF NOT EXISTS categories (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name_ar TEXT NOT NULL,
  name_en TEXT,
  slug VARCHAR(100) NOT NULL UNIQUE,
  icon_url TEXT,
  parent_id UUID REFERENCES categories(id) ON DELETE SET NULL,
  sort_order INTEGER DEFAULT 0 NOT NULL,
  created_at TIMESTAMP DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_categories_parent ON categories(parent_id);
CREATE INDEX IF NOT EXISTS idx_categories_slug ON categories(slug);

-- ══════════════════════════════════
-- 4. PRODUCTS (with pgvector embedding)
-- ══════════════════════════════════
CREATE TABLE IF NOT EXISTS products (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  category_id UUID NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
  name_ar TEXT NOT NULL,
  name_en TEXT,
  barcode VARCHAR(50),
  description TEXT,
  image_url TEXT,
  images TEXT[] DEFAULT '{}',
  price DECIMAL(10,2) NOT NULL,
  discount_price DECIMAL(10,2),
  stock_qty INTEGER DEFAULT 0 NOT NULL,
  unit TEXT DEFAULT 'piece' NOT NULL,
  is_featured BOOLEAN DEFAULT false NOT NULL,
  is_active BOOLEAN DEFAULT true NOT NULL,
  embedding vector(1536),
  created_at TIMESTAMP DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMP DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_products_featured ON products(is_featured) WHERE is_featured = true;
CREATE INDEX IF NOT EXISTS idx_products_active ON products(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_products_search ON products USING gin(to_tsvector('arabic', name_ar));

-- HNSW index for vector similarity search
CREATE INDEX IF NOT EXISTS idx_products_embedding ON products
  USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);

-- ══════════════════════════════════
-- 5. DRIVERS
-- ══════════════════════════════════
CREATE TABLE IF NOT EXISTS drivers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  phone VARCHAR(20) NOT NULL UNIQUE,
  status driver_status_enum DEFAULT 'available' NOT NULL,
  current_lat DECIMAL(10,7),
  current_lng DECIMAL(10,7),
  avatar_url TEXT,
  created_at TIMESTAMP DEFAULT NOW() NOT NULL
);

-- ══════════════════════════════════
-- 6. ORDERS
-- ══════════════════════════════════
CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  address_id UUID NOT NULL REFERENCES addresses(id) ON DELETE RESTRICT,
  status order_status_enum DEFAULT 'pending' NOT NULL,
  type order_type_enum DEFAULT 'catalog' NOT NULL,
  subtotal DECIMAL(10,2) NOT NULL,
  delivery_fee DECIMAL(10,2) DEFAULT 0 NOT NULL,
  service_fee DECIMAL(10,2) DEFAULT 0 NOT NULL,
  discount DECIMAL(10,2) DEFAULT 0 NOT NULL,
  total DECIMAL(10,2) NOT NULL,
  coupon_id UUID,
  driver_id UUID REFERENCES drivers(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMP DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at DESC);

-- ══════════════════════════════════
-- 7. ORDER ITEMS
-- ══════════════════════════════════
CREATE TABLE IF NOT EXISTS order_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  qty INTEGER NOT NULL,
  unit_price DECIMAL(10,2) NOT NULL,
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_product ON order_items(product_id);

-- ══════════════════════════════════
-- 8. DIRECT ORDERS
-- ══════════════════════════════════
CREATE TABLE IF NOT EXISTS direct_orders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  text_note TEXT,
  voice_url TEXT,
  images TEXT[],
  final_price DECIMAL(10,2)
);

CREATE INDEX IF NOT EXISTS idx_direct_orders_order ON direct_orders(order_id);

-- ══════════════════════════════════
-- 9. COUPONS
-- ══════════════════════════════════
CREATE TABLE IF NOT EXISTS coupons (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code VARCHAR(50) NOT NULL UNIQUE,
  type coupon_type_enum NOT NULL,
  value DECIMAL(10,2) NOT NULL,
  min_order DECIMAL(10,2),
  max_discount DECIMAL(10,2),
  source coupon_source_enum NOT NULL,
  expires_at TIMESTAMP,
  used_at TIMESTAMP,
  is_active BOOLEAN DEFAULT true NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_coupons_code ON coupons(code);
CREATE INDEX IF NOT EXISTS idx_coupons_active ON coupons(is_active);

-- ══════════════════════════════════
-- 10. SPIN RESULTS
-- ══════════════════════════════════
CREATE TABLE IF NOT EXISTS spin_results (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  result_type coupon_type_enum NOT NULL,
  result_value DECIMAL(10,2) NOT NULL,
  coupon_id UUID REFERENCES coupons(id) ON DELETE SET NULL,
  spun_at TIMESTAMP DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_spin_results_user ON spin_results(user_id);
CREATE INDEX IF NOT EXISTS idx_spin_results_spun ON spin_results(spun_at DESC);

-- ══════════════════════════════════
-- 11. LOYALTY TRANSACTIONS
-- ══════════════════════════════════
CREATE TABLE IF NOT EXISTS loyalty_transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  points INTEGER NOT NULL,
  type loyalty_tx_type_enum NOT NULL,
  ref_order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_loyalty_tx_user ON loyalty_transactions(user_id);

-- ══════════════════════════════════
-- 12. HOME INVENTORY
-- ══════════════════════════════════
CREATE TABLE IF NOT EXISTS home_inventory (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  qty_approx INTEGER DEFAULT 1 NOT NULL,
  alert_when_low BOOLEAN DEFAULT true NOT NULL,
  added_at TIMESTAMP DEFAULT NOW() NOT NULL,
  UNIQUE(user_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_home_inventory_user ON home_inventory(user_id);

-- ══════════════════════════════════
-- 13. SAVED LISTS
-- ══════════════════════════════════
CREATE TABLE IF NOT EXISTS saved_lists (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  items JSONB NOT NULL DEFAULT '[]',
  is_recurring BOOLEAN DEFAULT false NOT NULL,
  repeat_day INTEGER,
  created_at TIMESTAMP DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMP DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_saved_lists_user ON saved_lists(user_id);

-- ══════════════════════════════════
-- 14. NOTIFICATIONS
-- ══════════════════════════════════
CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title_ar TEXT NOT NULL,
  body_ar TEXT NOT NULL,
  type notification_type_enum NOT NULL,
  is_read BOOLEAN DEFAULT false NOT NULL,
  created_at TIMESTAMP DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(user_id, is_read) WHERE is_read = false;

-- ══════════════════════════════════
-- 15. BANNERS
-- ══════════════════════════════════
CREATE TABLE IF NOT EXISTS banners (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  image_url TEXT NOT NULL,
  link_type banner_link_type_enum NOT NULL,
  link_value TEXT,
  active BOOLEAN DEFAULT true NOT NULL,
  sort_order INTEGER DEFAULT 0 NOT NULL,
  created_at TIMESTAMP DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_banners_active_order ON banners(active, sort_order);

-- ══════════════════════════════════
-- 16. REVIEWS
-- ══════════════════════════════════
CREATE TABLE IF NOT EXISTS reviews (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  driver_rating INTEGER CHECK (driver_rating BETWEEN 1 AND 5),
  store_rating INTEGER CHECK (store_rating BETWEEN 1 AND 5),
  comment TEXT,
  created_at TIMESTAMP DEFAULT NOW() NOT NULL,
  UNIQUE(order_id)
);

-- ══════════════════════════════════
-- 17. WALLET TRANSACTIONS
-- ══════════════════════════════════
CREATE TABLE IF NOT EXISTS wallet_transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount DECIMAL(10,2) NOT NULL,
  type VARCHAR(20) NOT NULL,
  payment_ref VARCHAR(100),
  status VARCHAR(20) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_wallet_tx_user ON wallet_transactions(user_id);

-- ══════════════════════════════════
-- 18. AI SESSIONS
-- ══════════════════════════════════
CREATE TABLE IF NOT EXISTS ai_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  messages JSONB NOT NULL DEFAULT '[]',
  context_type VARCHAR(30) NOT NULL,
  products_suggested UUID[],
  created_at TIMESTAMP DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ai_sessions_user ON ai_sessions(user_id);

-- ══════════════════════════════════
-- GRANT PERMISSIONS
-- ══════════════════════════════════
GRANT ALL ON ALL TABLES IN SCHEMA public TO citymarket_user;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO citymarket_user;
GRANT USAGE ON SCHEMA public TO citymarket_user;
GRANT ALL ON ALL TABLES IN SCHEMA public TO citymarket_user;

-- ══════════════════════════════════
-- 19. CART (logged-in users)
-- ══════════════════════════════════
CREATE TABLE IF NOT EXISTS cart (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  quantity INTEGER DEFAULT 1 NOT NULL,
  created_at TIMESTAMP DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMP DEFAULT NOW() NOT NULL,
  UNIQUE(user_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_cart_user ON cart(user_id);

-- ══════════════════════════════════
-- 20. GUEST CART (unregistered users)
-- ══════════════════════════════════
CREATE TABLE IF NOT EXISTS guest_cart (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id VARCHAR(100) NOT NULL,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  quantity INTEGER DEFAULT 1 NOT NULL,
  created_at TIMESTAMP DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMP DEFAULT NOW() NOT NULL,
  UNIQUE(session_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_guest_cart_session ON guest_cart(session_id);

-- ══════════════════════════════════
-- UPDATED_AT TRIGGER FUNCTION
-- ══════════════════════════════════
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply to tables with updated_at
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_products_updated_at BEFORE UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_orders_updated_at BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_saved_lists_updated_at BEFORE UPDATE ON saved_lists
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_cart_updated_at BEFORE UPDATE ON cart
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_guest_cart_updated_at BEFORE UPDATE ON guest_cart
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
