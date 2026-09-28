-- Home layout builder — admin-driven composition of the storefront home page.
--
-- Each row holds the full ordered list of sections (JSONB) for one device
-- (mobile | desktop). The public API at /api/v1/home-layout?device=...
-- returns the active layout for that device so the web storefront and the
-- iOS app (out-of-repo) can render the same composition natively.
--
-- Sections are intentionally freeform JSONB — the admin page and the
-- public renderer share a typed contract in src/lib/home-layout-types.ts
-- (validated server-side by src/lib/validation/home-layout.ts via a zod
-- discriminated union). Storing as JSONB lets us add new section types
-- without a migration as long as the contract stays backward-compatible.

BEGIN;

CREATE TABLE IF NOT EXISTS home_layouts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_type TEXT NOT NULL UNIQUE
              CHECK (device_type IN ('mobile','desktop')),
  name        TEXT NOT NULL DEFAULT 'الافتراضي',
  sections    JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  updated_by  UUID REFERENCES admin_users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_home_layouts_active
  ON home_layouts(is_active) WHERE is_active;

-- updated_at trigger — same pattern as recent migrations (059+).
CREATE OR REPLACE FUNCTION home_layouts_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_home_layouts_updated_at ON home_layouts;
CREATE TRIGGER trg_home_layouts_updated_at
  BEFORE UPDATE ON home_layouts
  FOR EACH ROW EXECUTE FUNCTION home_layouts_set_updated_at();

GRANT ALL ON home_layouts TO citymarket_user;

-- Seed: two empty layouts (one per device) so the public GET has a row to
-- return and the fallback path (sections.length === 0 → HomeRedesign) is
-- testable without first running the admin UI.
INSERT INTO home_layouts (device_type, name, sections) VALUES
  ('mobile',  'الافتراضي - جوال',     '[]'::jsonb),
  ('desktop', 'الافتراضي - كمبيوتر',  '[]'::jsonb)
ON CONFLICT (device_type) DO NOTHING;

COMMIT;