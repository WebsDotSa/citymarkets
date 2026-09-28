-- Migration: Add stores and delivery distance-based pricing
-- Date: 2026-07-07
-- Description: Add stores (warehouses/branches) table and enhanced delivery zones with distance-based pricing

-- ============================================
-- STORES TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS stores (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    name_ar TEXT NOT NULL,
    address TEXT NOT NULL DEFAULT '',
    lat DECIMAL(10, 7) NOT NULL,
    lng DECIMAL(10, 7) NOT NULL,
    phone VARCHAR(20),
    is_active BOOLEAN NOT NULL DEFAULT true,
    is_main BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for finding main store quickly
CREATE INDEX IF NOT EXISTS idx_stores_main ON stores(is_main) WHERE is_main = true;
CREATE INDEX IF NOT EXISTS idx_stores_active ON stores(is_active) WHERE is_active = true;

-- ============================================
-- DELIVERY ZONES TABLE (Enhanced)
-- ============================================
-- First, drop the existing table if it exists and recreate with new columns
-- Note: If you have existing data, back it up first!

ALTER TABLE delivery_zones 
ADD COLUMN IF NOT EXISTS polygon_coords JSONB,
ADD COLUMN IF NOT EXISTS max_distance_km DECIMAL(10, 2),
ADD COLUMN IF NOT EXISTS supports_delivery BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

-- Create index for delivery zone lookups
CREATE INDEX IF NOT EXISTS idx_delivery_zones_active ON delivery_zones(is_active) WHERE is_active = true;

-- ============================================
-- DELIVERY SETTINGS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS delivery_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key VARCHAR(100) NOT NULL UNIQUE,
    value JSONB NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Insert default pricing settings
INSERT INTO delivery_settings (key, value) 
VALUES ('pricing', '{"baseFee": 12, "perKmRate": 1.5, "freeDeliveryMin": 150, "minOrder": 0, "maxDistanceKm": 50}')
ON CONFLICT (key) DO NOTHING;

-- ============================================
-- SAMPLE DATA (Optional - for testing)
-- ============================================

-- Add a sample main store (Riyadh - update coordinates with actual location)
-- INSERT INTO stores (name, name_ar, address, lat, lng, is_main, is_active)
-- VALUES ('Main Warehouse', 'المخزن الرئيسي', 'Riyadh, Saudi Arabia', 24.7136, 46.6753, true, true);

-- Add sample delivery zones
-- INSERT INTO delivery_zones (name_ar, city, max_distance_km, delivery_fee, free_delivery_min, is_active, sort_order)
-- VALUES 
--     ('الرياض - وسط المدينة', 'الرياض', 15, 10, 100, true, 1),
--     ('الرياض - شمال', 'الرياض', 30, 15, 150, true, 2),
--     ('الرياض - جنوب', 'الرياض', 25, 15, 150, true, 3),
--     ('الرياض - شرق', 'الرياض', 20, 12, 120, true, 4),
--     ('الرياض - غرب', 'الرياض', 25, 15, 150, true, 5);
