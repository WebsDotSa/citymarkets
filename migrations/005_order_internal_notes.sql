-- Operational notes visible to admins only (distinct from customer order notes).
ALTER TABLE orders ADD COLUMN IF NOT EXISTS internal_notes TEXT;
