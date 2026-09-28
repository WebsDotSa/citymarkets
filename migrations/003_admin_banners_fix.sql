-- Fix missing tables: admin_users, banners
-- Safe to run multiple times (IF NOT EXISTS)

-- Admin role enum
DO $$ BEGIN
  CREATE TYPE admin_role_enum AS ENUM ('super_admin', 'admin', 'manager', 'support');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Banner link type (may already exist from partial migration)
DO $$ BEGIN
  CREATE TYPE banner_link_type_enum AS ENUM ('product', 'category', 'external', 'none');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Admin users table
CREATE TABLE IF NOT EXISTS admin_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role admin_role_enum DEFAULT 'admin' NOT NULL,
  phone VARCHAR(20),
  avatar_url TEXT,
  is_active BOOLEAN DEFAULT true NOT NULL,
  last_login_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMP DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_admin_users_email ON admin_users(LOWER(email));

-- Banner link type was added later in the schema
DO $$ BEGIN
  ALTER TABLE banners ADD COLUMN link_type banner_link_type_enum DEFAULT 'none';
EXCEPTION WHEN duplicate_column THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE banners ADD COLUMN link_value TEXT;
EXCEPTION WHEN duplicate_column THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE banners ADD COLUMN sort_order INT DEFAULT 0;
EXCEPTION WHEN duplicate_column THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE banners ADD COLUMN active BOOLEAN DEFAULT true;
EXCEPTION WHEN duplicate_column THEN null; END $$;

-- Banners table (if missing entirely)
CREATE TABLE IF NOT EXISTS banners (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  image_url TEXT NOT NULL,
  title_ar TEXT,
  link_type banner_link_type_enum DEFAULT 'none',
  link_value TEXT,
  active BOOLEAN DEFAULT true,
  sort_order INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMP DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_banners_active_sort ON banners(active, sort_order);

-- Default banners (seeded only if no banners exist)
INSERT INTO banners (image_url, link_type, link_value, active, sort_order)
SELECT 'https://images.unsplash.com/photo-1542838132-92c53300491e?w=1200&h=400&fit=crop', 'category'::banner_link_type_enum, 'fruits-vegetables', true, 1
WHERE NOT EXISTS (SELECT 1 FROM banners LIMIT 1);

INSERT INTO banners (image_url, link_type, link_value, active, sort_order)
SELECT 'https://images.unsplash.com/photo-1604719312566-8912e9722e8f?w=1200&h=400&fit=crop', 'category'::banner_link_type_enum, 'grocery', true, 2
WHERE (SELECT COUNT(*) FROM banners) < 2;

-- Product images (update existing products without images).
-- FIX 2026-07-29: original used `WHERE id = N` (integer) but products.id is UUID
-- per migration 001 — the comparison crashed with "operator does not exist:
-- uuid = integer". barcode is the natural unique key from migration 002's seed:
-- id=1..5 were barcodes 1234567890..94 (Fruits & Vegetables); id=6..8 were
-- 2345678901..03 (Dairy). The UPDATEs are a defensive safety net — the seed
-- already populates images, so they match 0 rows on a fresh DB and update
-- only image-less rows in any other state.
UPDATE products SET image_url = 'https://images.unsplash.com/photo-1587593819181-38a4591c5f5b?w=400&h=400&fit=crop'
WHERE barcode = '1234567890' AND (image_url IS NULL OR image_url = '');

UPDATE products SET image_url = 'https://images.unsplash.com/photo-1602470520998-f4a52199a3d6?w=400&h=400&fit=crop'
WHERE barcode = '1234567891' AND (image_url IS NULL OR image_url = '');

UPDATE products SET image_url = 'https://images.unsplash.com/photo-1563636619-e9143da7973b?w=400&h=400&fit=crop'
WHERE barcode = '1234567892' AND (image_url IS NULL OR image_url = '');

UPDATE products SET image_url = 'https://images.unsplash.com/photo-1586444833468-7a9258d5c98b?w=400&h=400&fit=crop'
WHERE barcode = '1234567893' AND (image_url IS NULL OR image_url = '');

UPDATE products SET image_url = 'https://images.unsplash.com/photo-1548839140-29a749e1cf4d?w=400&h=400&fit=crop'
WHERE barcode = '1234567894' AND (image_url IS NULL OR image_url = '');

UPDATE products SET image_url = 'https://images.unsplash.com/photo-1546470427-0d4db154ceb8?w=400&h=400&fit=crop'
WHERE barcode = '2345678901' AND (image_url IS NULL OR image_url = '');

UPDATE products SET image_url = 'https://images.unsplash.com/photo-1571771894821-ce9b6c11b08e?w=400&h=400&fit=crop'
WHERE barcode = '2345678902' AND (image_url IS NULL OR image_url = '');

UPDATE products SET image_url = 'https://images.unsplash.com/photo-1481391319761-50e756a24696?w=400&h=400&fit=crop'
WHERE barcode = '2345678903' AND (image_url IS NULL OR image_url = '');

GRANT ALL ON admin_users TO citymarket_user;
GRANT ALL ON banners TO citymarket_user;
