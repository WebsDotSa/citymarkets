-- ============================================================================
-- 008_address_place_images.sql
-- Add place_images array column to addresses table for "Help the driver
-- find you faster" feature — stores up to 5 image URLs showing the building
-- entrance, gate number, landmark, etc.
-- ============================================================================

ALTER TABLE addresses
  ADD COLUMN IF NOT EXISTS place_images TEXT[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN addresses.place_images IS
  'Array of image URLs uploaded by the customer to help drivers locate the delivery address (building entrance, gate number, landmark, etc.). Max 5.';

-- Helper query for admins: addresses with at least one image
-- SELECT id, label, place_images FROM addresses WHERE array_length(place_images, 1) > 0;