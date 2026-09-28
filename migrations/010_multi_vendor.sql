-- 010_multi_vendor.sql
-- Multi-vendor stores: vendors, vendor_products, vendor_orders, vendor_staff, etc.

-- 1) Main vendors table
CREATE TABLE IF NOT EXISTS vendors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT UNIQUE NOT NULL,
  name_ar TEXT NOT NULL,
  name_en TEXT,
  description_ar TEXT,
  description_en TEXT,
  logo_url TEXT,
  banner_url TEXT,
  category_slug TEXT,
  vendor_type TEXT NOT NULL CHECK (vendor_type IN (
    'food_beverage', 'fashion', 'gifts', 'electronics', 'services'
  )),
  primary_color TEXT DEFAULT '#009345',
  contact_phone TEXT,
  contact_email TEXT,
  contact_whatsapp TEXT,
  address_ar TEXT,
  pickup_lat DECIMAL(10,7),
  pickup_lng DECIMAL(10,7),
  is_active BOOLEAN DEFAULT TRUE,
  is_featured BOOLEAN DEFAULT FALSE,
  sort_order INT DEFAULT 0,
  open_time TIME DEFAULT '09:00:00',
  close_time TIME DEFAULT '23:00:00',
  delivery_zone_ids UUID[],
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vendors_slug ON vendors(slug);
CREATE INDEX IF NOT EXISTS idx_vendors_active_featured ON vendors(is_active, is_featured, sort_order);

-- 2) Vendor staff (separate from admins)
CREATE TABLE IF NOT EXISTS vendor_staff (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id UUID NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  full_name_ar TEXT,
  full_name_en TEXT,
  role TEXT NOT NULL CHECK (role IN ('owner', 'manager', 'staff', 'viewer')),
  permissions TEXT[] DEFAULT '{}',
  is_active BOOLEAN DEFAULT TRUE,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(vendor_id, email)
);

CREATE INDEX IF NOT EXISTS idx_vendor_staff_vendor ON vendor_staff(vendor_id);
CREATE INDEX IF NOT EXISTS idx_vendor_staff_email ON vendor_staff(email);

-- 3) Vendor products
CREATE TABLE IF NOT EXISTS vendor_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id UUID NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  category_id UUID,
  name_ar TEXT NOT NULL,
  name_en TEXT,
  description_ar TEXT,
  description_en TEXT,
  image_urls TEXT[] DEFAULT '{}',
  price DECIMAL(10,2) NOT NULL,
  discount_price DECIMAL(10,2),
  sku TEXT,
  stock_quantity INT DEFAULT 0,
  track_stock BOOLEAN DEFAULT FALSE,
  is_active BOOLEAN DEFAULT TRUE,
  sort_order INT DEFAULT 0,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vendor_products_vendor ON vendor_products(vendor_id, is_active);
CREATE INDEX IF NOT EXISTS idx_vendor_products_category ON vendor_products(category_id);

-- 4) Vendor orders
CREATE TABLE IF NOT EXISTS vendor_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number TEXT UNIQUE NOT NULL,
  vendor_id UUID NOT NULL REFERENCES vendors(id),
  customer_id UUID,
  customer_name TEXT,
  customer_phone TEXT NOT NULL,
  customer_email TEXT,
  address_text TEXT,
  address_lat DECIMAL(10,7),
  address_lng DECIMAL(10,7),
  subtotal DECIMAL(10,2) NOT NULL,
  delivery_fee DECIMAL(10,2) DEFAULT 0,
  total DECIMAL(10,2) NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN (
    'pending', 'confirmed', 'preparing', 'ready', 'out_for_delivery', 'delivered', 'cancelled', 'refunded'
  )),
  payment_method TEXT CHECK (payment_method IN ('moyasar_card', 'moyasar_applepay', 'cod')),
  payment_status TEXT DEFAULT 'pending' CHECK (payment_status IN ('pending', 'paid', 'failed', 'refunded')),
  moyasar_payment_id TEXT,
  notes TEXT,
  confirmed_at TIMESTAMPTZ,
  prepared_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vendor_orders_vendor ON vendor_orders(vendor_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_vendor_orders_customer ON vendor_orders(customer_phone);
CREATE INDEX IF NOT EXISTS idx_vendor_orders_order_number ON vendor_orders(order_number);

-- 5) Vendor order items
CREATE TABLE IF NOT EXISTS vendor_order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES vendor_orders(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES vendor_products(id),
  product_name_snapshot TEXT NOT NULL,
  unit_price DECIMAL(10,2) NOT NULL,
  quantity INT NOT NULL,
  line_total DECIMAL(10,2) NOT NULL,
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_vendor_order_items_order ON vendor_order_items(order_id);

-- 6) Vendor settings
CREATE TABLE IF NOT EXISTS vendor_settings (
  vendor_id UUID PRIMARY KEY REFERENCES vendors(id) ON DELETE CASCADE,
  delivery_mode TEXT DEFAULT 'shared' CHECK (delivery_mode IN ('shared', 'own_courier', 'pickup_only')),
  delivery_fee_override DECIMAL(10,2),
  min_order_amount DECIMAL(10,2) DEFAULT 0,
  accepts_cod BOOLEAN DEFAULT TRUE,
  accepts_online_payment BOOLEAN DEFAULT TRUE,
  notify_on_new_order_whatsapp TEXT,
  notify_on_new_order_email TEXT,
  meta_title_ar TEXT,
  meta_description_ar TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 7) Vendor coupons
CREATE TABLE IF NOT EXISTS vendor_coupons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id UUID NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  discount_type TEXT CHECK (discount_type IN ('percent', 'fixed')),
  discount_value DECIMAL(10,2) NOT NULL,
  min_order DECIMAL(10,2) DEFAULT 0,
  max_uses INT,
  current_uses INT DEFAULT 0,
  valid_from TIMESTAMPTZ,
  valid_until TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(vendor_id, code)
);

CREATE INDEX IF NOT EXISTS idx_vendor_coupons_vendor ON vendor_coupons(vendor_id, is_active);

-- 8) Vendor daily stats
CREATE TABLE IF NOT EXISTS vendor_daily_stats (
  vendor_id UUID NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  stat_date DATE NOT NULL,
  orders_count INT DEFAULT 0,
  orders_completed INT DEFAULT 0,
  orders_cancelled INT DEFAULT 0,
  revenue_total DECIMAL(12,2) DEFAULT 0,
  unique_customers INT DEFAULT 0,
  new_customers INT DEFAULT 0,
  avg_order_value DECIMAL(10,2) DEFAULT 0,
  PRIMARY KEY (vendor_id, stat_date)
);

-- 9) Admin access to vendors
CREATE TABLE IF NOT EXISTS admin_vendor_access (
  admin_id UUID NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  vendor_id UUID NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  can_manage BOOLEAN DEFAULT TRUE,
  PRIMARY KEY (admin_id, vendor_id)
);

-- Seed initial vendors
INSERT INTO vendors (slug, name_ar, name_en, vendor_type, category_slug, is_featured, sort_order, description_ar, primary_color) VALUES
('qahwa-amaze', 'قهوة Amaze', 'Amaze Coffee', 'food_beverage', 'specialty', TRUE, 1, 'أفضل قهوة في الرياض مع أجواء مميزة', '#8B4513'),
('abaya-store', 'عبايات', 'Abayas', 'fashion', 'fashion', TRUE, 2, 'عبايات فاخرة بأحدث التصاميم', '#9C27B0'),
('gifts', 'هدايا', 'Gifts', 'gifts', 'gifts', TRUE, 3, 'أجمل الهدايا للمناسبات المختلفة', '#E91E63')
ON CONFLICT (slug) DO NOTHING;

-- Seed default settings for vendors
INSERT INTO vendor_settings (vendor_id, delivery_mode, min_order_amount, accepts_cod, accepts_online_payment)
SELECT id, 'shared', 0, TRUE, TRUE FROM vendors
WHERE slug IN ('qahwa-amaze', 'abaya-store', 'gifts')
ON CONFLICT (vendor_id) DO NOTHING;
