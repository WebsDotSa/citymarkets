-- 019_page_views.sql
-- Purpose: lightweight in-house pageview tracking. We use this to count
--          visits per page without an external dependency (PostHog, GA).
-- Owner: citymarket_user. RLS open (WITH CHECK true) — the route handler
--        filters malicious callers (skip admin/vendor/api paths).

CREATE TABLE IF NOT EXISTS page_views (
  id           BIGSERIAL PRIMARY KEY,
  path         TEXT NOT NULL,
  referrer     TEXT,
  user_agent   TEXT,
  session_id   TEXT,
  country      CHAR(2),
  occurred_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  time_bucket  TIMESTAMPTZ NOT NULL DEFAULT date_trunc('minute', NOW())
);

CREATE INDEX IF NOT EXISTS idx_page_views_path_time  ON page_views (path, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_page_views_session    ON page_views (session_id);
CREATE INDEX IF NOT EXISTS idx_page_views_occurred   ON page_views (occurred_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_page_views_dedupe
  ON page_views (path, session_id, time_bucket);

ALTER TABLE page_views ENABLE ROW LEVEL SECURITY;
ALTER TABLE page_views FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "page_views_public_read" ON page_views;
DROP POLICY IF EXISTS "page_views_insert_any"    ON page_views;
CREATE POLICY "page_views_public_read" ON page_views FOR SELECT USING (true);
CREATE POLICY "page_views_insert_any"  ON page_views FOR INSERT WITH CHECK (true);

GRANT ALL ON page_views TO citymarket_user;
GRANT USAGE, SELECT ON SEQUENCE page_views_id_seq TO citymarket_user;
