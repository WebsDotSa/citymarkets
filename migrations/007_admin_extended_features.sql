-- Admin: delivery zones, audit log, app settings, reviews, payment events

CREATE TABLE IF NOT EXISTS delivery_zones (
  id SERIAL PRIMARY KEY,
  name_ar TEXT NOT NULL,
  city TEXT,
  district_pattern TEXT,
  delivery_fee NUMERIC(10, 2) NOT NULL DEFAULT 12,
  free_delivery_min NUMERIC(10, 2) DEFAULT 150,
  min_order NUMERIC(10, 2) DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_delivery_zones_active ON delivery_zones(is_active, sort_order);

CREATE TABLE IF NOT EXISTS admin_audit_logs (
  id SERIAL PRIMARY KEY,
  admin_id UUID,
  admin_email TEXT,
  admin_name TEXT,
  action VARCHAR(64) NOT NULL,
  entity_type VARCHAR(64),
  entity_id TEXT,
  details JSONB DEFAULT '{}',
  ip_address TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_created ON admin_audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_admin ON admin_audit_logs(admin_email);

CREATE TABLE IF NOT EXISTS app_settings (
  key VARCHAR(128) PRIMARY KEY,
  value JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO app_settings (key, value) VALUES
  ('notifications', '{"whatsapp_admin_phone":"","notify_new_order":true,"message_template":"طلب جديد #{order_id} — {customer} — {total} ر.س"}'),
  ('inventory', '{"low_stock_threshold":5}'),
  ('payments', '{"moyasar_enabled":true}')
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS reviews (
  id SERIAL PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  driver_rating INTEGER CHECK (driver_rating BETWEEN 1 AND 5),
  store_rating INTEGER CHECK (store_rating BETWEEN 1 AND 5),
  comment TEXT,
  admin_reply TEXT,
  is_visible BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (order_id)
);

CREATE INDEX IF NOT EXISTS idx_reviews_created ON reviews(created_at DESC);

-- payment_events table is created by migration 073 with the canonical
-- schema (invoice_id, gateway, event_type, raw_payload, status). 007
-- used to create a legacy payment_events with a different column set
-- (order_id INTEGER, payment_reference, provider, payload) that does
-- not match what the application code (src/lib/payments/event-ledger.ts,
-- src/lib/payments/moyasar-confirm.ts) reads/writes. We deliberately
-- drop the legacy create here so 073 owns the table and the schema
-- matches the application.

GRANT ALL ON delivery_zones TO citymarket_user;
GRANT ALL ON admin_audit_logs TO citymarket_user;
GRANT ALL ON app_settings TO citymarket_user;
GRANT ALL ON reviews TO citymarket_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO citymarket_user;
