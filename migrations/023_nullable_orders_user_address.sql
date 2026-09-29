-- 023_nullable_orders_user_address.sql
-- Fix schema violation: orders.user_id and address_id are NOT NULL
-- but guest checkout creates orders with null user_id and pickup orders don't have address
--
-- This migration makes these columns nullable to match the actual business logic.

BEGIN;

-- 0. Make sure guest_phone exists before the contact check constraint
-- references it. 001's orders schema doesn't have guest_phone; 006
-- would have added it via CREATE TABLE IF NOT EXISTS (no-op because
-- 001 already created the table), so we add it explicitly here. Safe
-- to re-run on production where it already exists.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS guest_phone VARCHAR(32);

-- 1. Make user_id nullable (guest checkout doesn't have user)
ALTER TABLE orders ALTER COLUMN user_id DROP NOT NULL;

-- 2. Make address_id nullable (pickup orders don't need address)
ALTER TABLE orders ALTER COLUMN address_id DROP NOT NULL;

-- 3. Add check constraint to ensure at least guest_phone or user_id exists
-- This ensures every order has a way to contact the customer
ALTER TABLE orders ADD CONSTRAINT orders_has_contact CHECK (
    user_id IS NOT NULL OR guest_phone IS NOT NULL
);

-- 4. Add comment for documentation
COMMENT ON COLUMN orders.user_id IS 'Nullable for guest checkout orders';
COMMENT ON COLUMN orders.address_id IS 'Nullable for pickup orders';

-- 5. Update migration log
INSERT INTO public.schema_migrations (version, description)
VALUES ('023', 'Make orders.user_id and address_id nullable; add contact check constraint')
ON CONFLICT (version) DO NOTHING;

COMMIT;
