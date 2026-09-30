-- 079 — Per-branch opening hours for the `stores` table.
--
-- Background: the platform currently uses a single global
-- `delivery_settings.hours` (one open/close window for every day of
-- the week). Operators who run multi-branch delivery (e.g. a branch
-- that closes earlier on weekends) had no way to express that
-- without overriding the global config. This migration adds a
-- per-branch JSONB column so the admin can enable distinct working
-- hours on a single store without touching the rest of the chain.
--
-- Defaults:
--   - `enabled = false` so existing rows behave IDENTICALLY to the
--     pre-migration flow (the global `delivery_settings.hours` wins).
--   - `open_time` / `close_time` mirror the global defaults
--     (`09:00` – `23:00` Riyadh) so a future flip of `enabled` is a
--     no-op surprise.
--   - `closed_message` is set to a branch-local copy so the
--     storefront banner can quote the right branch when this row is
--     the active serving branch.
--
-- The `closing_at` partial index is for a future optimisation: when
-- we eventually surface per-branch open status on the public
-- `/store-status` endpoint, we'll filter on `(is_active = true AND
-- opening_hours->>'enabled' = 'true')` and this index keeps the
-- lookup O(rows-with-enabled-hours) instead of scanning every store.

ALTER TABLE stores
  ADD COLUMN IF NOT EXISTS opening_hours JSONB NOT NULL DEFAULT '{
    "enabled": false,
    "open_time": "09:00",
    "close_time": "23:00",
    "timezone": "Asia/Riyadh",
    "closed_message": "هذا الفرع مغلق حالياً"
  }'::jsonb;

-- Backfill: any pre-existing stores that did not receive the DEFAULT
-- (e.g. added via SQL that bypassed the default) get the same shape
-- we just declared. `COALESCE` keeps the migration idempotent.
UPDATE stores
SET opening_hours = '{
  "enabled": false,
  "open_time": "09:00",
  "close_time": "23:00",
  "timezone": "Asia/Riyadh",
  "closed_message": "هذا الفرع مغلق حالياً"
}'::jsonb
WHERE opening_hours IS NULL
   OR opening_hours = '{}'::jsonb
   OR NOT (opening_hours ? 'enabled');

-- 079.b — Index for the future `enabled AND is_active` filter.
CREATE INDEX IF NOT EXISTS idx_stores_enabled_hours
  ON stores (is_active)
  WHERE (opening_hours->>'enabled')::boolean = true;
