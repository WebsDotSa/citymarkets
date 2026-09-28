-- Migration: 024_performance_and_security
-- Adds user_id index on reviews table for faster lookups
-- Hashes OTP codes in database for security
-- Adds index on orders.user_id for guest orders tracking
-- Adds composite indexes for common query patterns

-- 1. Index on reviews.user_id (for "my reviews" queries)
CREATE INDEX IF NOT EXISTS idx_reviews_user_id ON reviews(user_id);

-- 2. Index on orders.user_id (for order history queries)
CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id);

-- 3. Index on orders.address_id (for delivery queries)
CREATE INDEX IF NOT EXISTS idx_orders_address_id ON orders(address_id);

-- 4. Note: user_otps doesn't have phone column, OTPs are looked up by user_id (already has index via primary key)

-- 5. Composite index for active products by category
CREATE INDEX IF NOT EXISTS idx_products_category_active ON products(category_id, is_active) WHERE is_active = true;

-- 6. Composite index for product search
CREATE INDEX IF NOT EXISTS idx_products_search ON products USING gin(to_tsvector('arabic', name_ar || ' ' || COALESCE(name_en, '')));

-- 7. Index on push_subscriptions for user lookups
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user_id ON push_subscriptions(user_id);

-- 8. Index on vendor_coupons for code lookups
CREATE INDEX IF NOT EXISTS idx_vendor_coupons_code ON vendor_coupons(vendor_id, UPPER(code));

-- 9. Note: OTP hashing is now handled in application code (login/route.ts and verify/route.ts)
-- Old unhashed OTPs will continue to work until they expire (5 minutes)
