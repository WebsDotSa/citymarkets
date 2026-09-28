-- Add is_active toggle for categories (admin can hide without deleting)
-- Add description_ar for richer category pages (optional SEO copy)
ALTER TABLE categories
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS description_ar TEXT,
  ADD COLUMN IF NOT EXISTS description_en TEXT;

CREATE INDEX IF NOT EXISTS idx_categories_active
  ON categories (is_active)
  WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_categories_parent_active
  ON categories (parent_id, is_active);

COMMENT ON COLUMN categories.is_active IS
  'When false, hidden from public catalog and store-front but kept in admin for analytics & restore.';
COMMENT ON COLUMN categories.description_ar IS
  'Optional Arabic description shown on category landing page. Supports basic SEO copy.';
COMMENT ON COLUMN categories.description_en IS
  'Optional English description shown on category landing page.';