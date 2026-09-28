-- Performance indexes for better query performance

-- Composite index for user orders by status and date
-- Optimizes: SELECT * FROM orders WHERE user_id = $1 ORDER BY created_at DESC
CREATE INDEX IF NOT EXISTS idx_orders_user_status_date 
ON orders(user_id, created_at DESC);

-- Composite index for orders by status and date
-- Optimizes: SELECT * FROM orders WHERE status = 'pending' ORDER BY created_at DESC
CREATE INDEX IF NOT EXISTS idx_orders_status_date 
ON orders(status, created_at DESC);

-- Index for coupon code lookups
CREATE INDEX IF NOT EXISTS idx_orders_coupon_code 
ON orders(coupon_code) WHERE coupon_code IS NOT NULL;

-- Index for payment reference lookups
CREATE INDEX IF NOT EXISTS idx_orders_payment_status 
ON orders(payment_status) WHERE payment_status != 'paid';

-- Composite index for order items by order and product
CREATE INDEX IF NOT EXISTS idx_order_items_order_product 
ON order_items(order_id, product_id);

-- Index for guest session cart lookups
CREATE INDEX IF NOT EXISTS idx_guest_cart_session_updated 
ON guest_cart(session_id, updated_at DESC);

-- Index for user cart lookups with product info
CREATE INDEX IF NOT EXISTS idx_cart_user_product 
ON cart(user_id, product_id);

-- Partial index for active categories
CREATE INDEX IF NOT EXISTS idx_categories_active 
ON categories(sort_order) WHERE is_active = true;

-- Composite index for product search
CREATE INDEX IF NOT EXISTS idx_products_category_active 
ON products(category_id, is_active) WHERE is_active = true;

-- Index for low stock products
CREATE INDEX IF NOT EXISTS idx_products_low_stock 
ON products(category_id) WHERE is_active = true AND stock_qty <= 10;

-- Index for address lookups by user
CREATE INDEX IF NOT EXISTS idx_addresses_user_default 
ON addresses(user_id, is_default DESC) WHERE is_default = true;
