-- 047: Scheduled delivery — adds `scheduled_for` (timestamp) and `scheduled`
-- (boolean) columns to orders. `scheduled` is the canonical flag; `scheduled_for`
-- is null for express orders and the user-chosen slot start for scheduled ones.
--
-- Slot configuration lives in `delivery_settings.slots` as JSON — same
-- key-value pattern as `delivery_settings.pricing`. Default slots ship
-- with this migration; admin can override via /api/admin/delivery-settings.
--
-- Default slots (every day):
--   morning    : 09:00 – 11:00  (capacity 20 orders)
--   noon       : 12:00 – 14:00  (capacity 25)
--   afternoon  : 15:00 – 17:00  (capacity 25)
--   evening    : 18:00 – 20:00  (capacity 30)
--
-- Lead time: orders must be placed ≥ 2 hours before the slot start.

BEGIN;

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS scheduled_for timestamp without time zone,
  ADD COLUMN IF NOT EXISTS scheduled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS slot_window text;

CREATE INDEX IF NOT EXISTS idx_orders_scheduled_for
  ON orders (scheduled_for)
  WHERE scheduled = true;

-- Seed default slots config (idempotent via ON CONFLICT).
INSERT INTO delivery_settings (key, value)
VALUES (
  'slots',
  '{
    "enabled": true,
    "lead_time_minutes": 120,
    "max_days_ahead": 7,
    "min_days_ahead": 0,
    "timezone": "Asia/Riyadh",
    "slot_duration_minutes": 120,
    "windows": [
      { "id": "morning",    "label_ar": "صباحاً",   "start": "09:00", "end": "11:00", "capacity": 20 },
      { "id": "noon",       "label_ar": "ظهراً",     "start": "12:00", "end": "14:00", "capacity": 25 },
      { "id": "afternoon",  "label_ar": "عصراً",     "start": "15:00", "end": "17:00", "capacity": 25 },
      { "id": "evening",    "label_ar": "مساءً",     "start": "18:00", "end": "20:00", "capacity": 30 }
    ]
  }'::jsonb
)
ON CONFLICT (key) DO NOTHING;

COMMIT;