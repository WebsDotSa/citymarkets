-- Delivery addresses (supports logged-in user_id or guest_key)
CREATE TABLE IF NOT EXISTS addresses (
  id SERIAL PRIMARY KEY,
  user_id TEXT,
  guest_key VARCHAR(64),
  label VARCHAR(100) NOT NULL,
  lat DOUBLE PRECISION NOT NULL DEFAULT 0,
  lng DOUBLE PRECISION NOT NULL DEFAULT 0,
  address_text TEXT NOT NULL,
  description TEXT,
  is_default BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT addresses_owner_check CHECK (user_id IS NOT NULL OR guest_key IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_addresses_user_id ON addresses(user_id);
CREATE INDEX IF NOT EXISTS idx_addresses_guest_key ON addresses(guest_key);
