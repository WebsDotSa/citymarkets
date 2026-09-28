-- 041_analytics.sql
-- Purpose: comprehensive analytics backend.
--   (a) Extend `page_views` with vendor_slug + device_type + event_type so
--       visitor analytics can be segmented by store / device / event.
--   (b) Add `analytics_events` for custom in-house events (add_to_cart,
--       checkout_start, purchase, search, signup). GA4 still runs in
--       parallel via useAnalytics, but the in-house table is the source
--       of truth for the admin dashboard.
--   (c) Add `daily_visitor_stats` materialized view for fast day-by-day
--       aggregation (rebuilt on demand by the admin route).
-- Owner: citymarket_user. RLS open (WITH CHECK true) for INSERT — the
--        route handlers filter malicious paths (skip /admin, /vendor, /api).

BEGIN;

-- ---------------------------------------------------------------------------
-- (a) Extend page_views
-- ---------------------------------------------------------------------------

ALTER TABLE page_views
  ADD COLUMN IF NOT EXISTS vendor_slug TEXT,
  ADD COLUMN IF NOT EXISTS device_type TEXT
    CHECK (device_type IN ('mobile', 'tablet', 'desktop', 'bot')),
  ADD COLUMN IF NOT EXISTS event_type TEXT NOT NULL DEFAULT 'pageview';

CREATE INDEX IF NOT EXISTS idx_page_views_vendor_time
  ON page_views (vendor_slug, occurred_at DESC)
  WHERE vendor_slug IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_page_views_event_time
  ON page_views (event_type, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_page_views_device_time
  ON page_views (device_type, occurred_at DESC)
  WHERE device_type IS NOT NULL;

-- ---------------------------------------------------------------------------
-- (b) analytics_events (custom event ledger)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS analytics_events (
  id           BIGSERIAL PRIMARY KEY,
  event_name   TEXT NOT NULL,
  session_id   TEXT,
  user_id      UUID,
  vendor_id    UUID REFERENCES vendors(id) ON DELETE SET NULL,
  order_id     UUID REFERENCES orders(id)  ON DELETE SET NULL,
  product_id   UUID REFERENCES products(id) ON DELETE SET NULL,
  revenue      NUMERIC(10,2),
  currency     CHAR(3) DEFAULT 'SAR',
  metadata     JSONB DEFAULT '{}'::jsonb,
  occurred_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_analytics_events_name_time
  ON analytics_events (event_name, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_events_session
  ON analytics_events (session_id) WHERE session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_analytics_events_vendor_time
  ON analytics_events (vendor_id, occurred_at DESC)
  WHERE vendor_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_analytics_events_order
  ON analytics_events (order_id) WHERE order_id IS NOT NULL;

ALTER TABLE analytics_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics_events FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "analytics_events_select_any" ON analytics_events;
DROP POLICY IF EXISTS "analytics_events_insert_any" ON analytics_events;
CREATE POLICY "analytics_events_select_any" ON analytics_events FOR SELECT USING (true);
CREATE POLICY "analytics_events_insert_any" ON analytics_events FOR INSERT WITH CHECK (true);

GRANT ALL ON analytics_events TO citymarket_user;
GRANT USAGE, SELECT ON SEQUENCE analytics_events_id_seq TO citymarket_user;

-- ---------------------------------------------------------------------------
-- (c) daily_visitor_stats (materialized view)
--     Aggressive 400-day window so the underlying scan stays bounded.
--     Must be REFRESHed either on a cron or on first admin request of
--     the day; the admin route issues REFRESH MATERIALIZED VIEW CONCURRENTLY
--     once per request to keep it fresh enough for the dashboard.
-- ---------------------------------------------------------------------------

DROP MATERIALIZED VIEW IF EXISTS daily_visitor_stats;

CREATE MATERIALIZED VIEW daily_visitor_stats AS
SELECT
  DATE_TRUNC('day', occurred_at AT TIME ZONE 'Asia/Riyadh')::date AS day,
  COUNT(*)                                  AS page_views,
  COUNT(DISTINCT session_id)                AS unique_sessions,
  COUNT(DISTINCT country)                   AS countries,
  COUNT(*) FILTER (WHERE device_type = 'mobile')  AS mobile_views,
  COUNT(*) FILTER (WHERE device_type = 'desktop') AS desktop_views,
  COUNT(*) FILTER (WHERE device_type = 'tablet')  AS tablet_views,
  COUNT(*) FILTER (WHERE event_type = 'pageview')  AS page_view_events
FROM page_views
WHERE occurred_at >= NOW() - INTERVAL '400 days'
GROUP BY 1;

CREATE UNIQUE INDEX IF NOT EXISTS uq_daily_visitor_stats_day
  ON daily_visitor_stats (day);

GRANT SELECT ON daily_visitor_stats TO citymarket_user;

COMMIT;
