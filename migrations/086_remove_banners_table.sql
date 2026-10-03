-- Remove banners table (P0 cleanup)
-- Banners are now fully managed through admin/home-design (home_layouts table)
-- No more standalone /api/v1/banners endpoint

DROP TABLE IF EXISTS banners CASCADE;
