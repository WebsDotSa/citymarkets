-- Add the display color used by the admin delivery-zone editor.
ALTER TABLE delivery_zones
  ADD COLUMN IF NOT EXISTS color VARCHAR(7) NOT NULL DEFAULT '#FF6B6B';
