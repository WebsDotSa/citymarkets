-- 044_broadcasts.sql
-- Multi-channel broadcast notification center (Composer / Campaigns / Templates / Metrics).
--
-- Adds:
--   broadcasts             — one campaign (composed, scheduled or immediate)
--   broadcast_templates    — reusable, channel-aware content blocks
--   broadcast_deliveries   — one row per (broadcast, user, channel) — source of truth for metrics
--   native_push_dispatch_log — APNs/FCM call audit log
--
-- Backwards-compatible: the legacy `app_settings('notifications', ...)` block
-- (whatsapp_admin_phone, notify_new_order, message_template) stays intact.

BEGIN;

-- broadcast_templates must be created BEFORE broadcasts because the
-- `broadcasts.template_id` FK (line 26 of the original file) references it.
-- Originally this file created `broadcasts` first, which made the FK
-- resolution fail with `relation "broadcast_templates" does not exist`
-- when the runner reached this file on a fresh DB.

CREATE TABLE IF NOT EXISTS broadcast_templates (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  description     TEXT,
  category        TEXT
                  CHECK (category IS NULL OR category IN ('promo','order','loyalty','blog','system')),
  channels        TEXT[] NOT NULL
                  CHECK (channels <@ ARRAY['web_push','native_push','sms','email','in_app']::TEXT[]),
  content         JSONB NOT NULL,
  variables       TEXT[] NOT NULL DEFAULT '{}',
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_by      UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_templates_category
  ON broadcast_templates(category);
CREATE INDEX IF NOT EXISTS idx_templates_active
  ON broadcast_templates(is_active) WHERE is_active = TRUE;

CREATE TABLE IF NOT EXISTS broadcasts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title           TEXT NOT NULL,
  body            TEXT NOT NULL,
  body_html       TEXT,
  image_url       TEXT,
  cta_label       TEXT,
  cta_url         TEXT,
  channels        TEXT[] NOT NULL
                  CHECK (channels <@ ARRAY['web_push','native_push','sms','email','in_app']::TEXT[]),
  audience        JSONB NOT NULL,
  template_id     UUID REFERENCES broadcast_templates(id) ON DELETE SET NULL,
  status          TEXT NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft','scheduled','sending','sent','cancelled','failed')),
  scheduled_at    TIMESTAMPTZ,
  started_at      TIMESTAMPTZ,
  finished_at     TIMESTAMPTZ,
  created_by      UUID NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  stats           JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_broadcasts_status_scheduled
  ON broadcasts(status, scheduled_at)
  WHERE status = 'scheduled';
CREATE INDEX IF NOT EXISTS idx_broadcasts_created_at
  ON broadcasts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_broadcasts_status
  ON broadcasts(status);

CREATE TABLE IF NOT EXISTS broadcast_deliveries (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  broadcast_id    UUID NOT NULL REFERENCES broadcasts(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel         TEXT NOT NULL
                  CHECK (channel IN ('web_push','native_push','sms','email','in_app')),
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','sent','delivered','opened','clicked','failed','skipped')),
  external_id     TEXT,
  error_message   TEXT,
  attempts        INT NOT NULL DEFAULT 0,
  sent_at         TIMESTAMPTZ,
  delivered_at    TIMESTAMPTZ,
  opened_at       TIMESTAMPTZ,
  clicked_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(broadcast_id, user_id, channel)
);

CREATE INDEX IF NOT EXISTS idx_deliveries_broadcast_channel
  ON broadcast_deliveries(broadcast_id, channel, status);
CREATE INDEX IF NOT EXISTS idx_deliveries_user
  ON broadcast_deliveries(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_deliveries_pending
  ON broadcast_deliveries(broadcast_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_deliveries_status
  ON broadcast_deliveries(status);

CREATE TABLE IF NOT EXISTS native_push_dispatch_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id     UUID NOT NULL REFERENCES broadcast_deliveries(id) ON DELETE CASCADE,
  platform        TEXT NOT NULL CHECK (platform IN ('apns','fcm')),
  bundle_id       TEXT,
  payload         JSONB NOT NULL,
  response        JSONB,
  status_code     INT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_npd_log_delivery
  ON native_push_dispatch_log(delivery_id);

COMMIT;