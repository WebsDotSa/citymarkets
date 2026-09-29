-- 077 — drop legacy `banners` table and `banner_link_type_enum`.
--
-- The standalone `/admin/banners` CRUD page was retired after banners
-- became a section type inside the `home-design` JSONB layout
-- (`home_layouts.sections`). The admin now manages every banner from
-- `/admin/home-design`, and the public renderer reads the JSONB sections
-- via `src/components/storefront/home/section-renderers.tsx::BannersRenderer`.
--
-- Safety: refuse to drop a non-empty table — the operator must migrate
-- any in-use rows to the new home-design layout (one `banners` section
-- per layout) before re-running. The `IF EXISTS` guards keep the
-- migration idempotent on databases where the table has already been
-- dropped manually.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM banners) THEN
    RAISE EXCEPTION
      'banners table is non-empty. Migrate rows to a home-design `banners` section first.';
  END IF;
END $$;

DROP TABLE IF EXISTS banners;
DROP TYPE IF EXISTS banner_link_type_enum;