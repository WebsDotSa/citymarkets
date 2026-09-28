-- 053_direct_orders.sql
-- Purpose: support the customer "Direct Order" feature for أسواق سيتي.
-- Customers tap "طلب مباشر" → choose payment → optionally record a voice
-- note + text notes → confirm service fee → submit. The order appears
-- inside /orders (with chat, edit, and add products) and is visible to
-- admins under /admin/(dashboard)/orders. A lightweight message thread
-- (customer ↔ admin/driver) lives next to each direct order so both
-- sides can coordinate without leaving the order screen.
--
-- Pre-conditions verified 2026-08-17:
--   * orders.type enum already includes 'direct' (added earlier)
--   * orders.service_fee/tax/payment_method already exist
--   * order_items already supports catalog lines
--
-- Tables / columns added:
--   * direct_order_items (standalone items not tied to products catalog,
--     like "ابغى 5 كيلو طماطم إذا متوفر" — used by edit-order flow)
--   * direct_order_messages (chat between customer and admin)
--   * direct_order_meta (1:1 with orders when type='direct':
--     delivery_lat/lng, fee_acknowledged_at, voice_note_url)
--   * orders.voice_note_url + orders.voice_note_duration (top-level
--     convenience columns used by the track page + chat)

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Voice note columns on orders (also reused by catalog orders for the
--    "voice note from driver" feature already shipping on the track page)
-- ---------------------------------------------------------------------------
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS voice_note_url TEXT,
  ADD COLUMN IF NOT EXISTS voice_note_duration INTEGER,
  ADD COLUMN IF NOT EXISTS service_fee_acknowledged_at TIMESTAMP;

-- ---------------------------------------------------------------------------
-- 2. Direct-order meta (1:1 with orders, only populated for type='direct')
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS direct_order_meta (
  order_id            UUID PRIMARY KEY REFERENCES orders(id) ON DELETE CASCADE,
  delivery_lat        DOUBLE PRECISION,
  delivery_lng        DOUBLE PRECISION,
  delivery_plus_code  TEXT,
  city                TEXT,
  district            TEXT,
  fee_acknowledged    BOOLEAN NOT NULL DEFAULT FALSE,
  customer_edited     BOOLEAN NOT NULL DEFAULT FALSE,
  last_edited_at      TIMESTAMP,
  created_at          TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_direct_order_meta_edited
  ON direct_order_meta (last_edited_at DESC NULLS LAST)
  WHERE customer_edited = TRUE;

-- ---------------------------------------------------------------------------
-- 3. Direct-order free-form items (the customer's text/voice requests
--    that are NOT linked to products_unified — e.g. "ابغى 5 كيلو رز
--    أبو الوليد إذا متوفر"). Admin can later promote a free item into
--    a catalog order_item.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS direct_order_items (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id            UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id          UUID REFERENCES products(id) ON DELETE SET NULL,
  free_text           TEXT,
  quantity            INTEGER NOT NULL DEFAULT 1,
  unit_price          NUMERIC(10,2) NOT NULL DEFAULT 0,
  -- admin-only resolved price (filled when the operator confirms the
  -- free_text request against actual products)
  resolved_price      NUMERIC(10,2),
  resolved_product_id UUID REFERENCES products(id) ON DELETE SET NULL,
  resolved_at         TIMESTAMP,
  resolved_by_admin_id UUID REFERENCES admin_users(id) ON DELETE SET NULL,
  notes               TEXT,
  created_at          TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_direct_order_items_order
  ON direct_order_items (order_id, created_at);

-- ---------------------------------------------------------------------------
-- 4. Direct-order chat thread (customer ↔ admin/driver)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS direct_order_messages (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id      UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  sender_type   TEXT NOT NULL CHECK (sender_type IN ('customer','admin','system')),
  sender_user_id     UUID,
  sender_admin_id    UUID REFERENCES admin_users(id) ON DELETE SET NULL,
  body          TEXT,
  audio_url     TEXT,
  audio_duration INTEGER,
  -- 'text' | 'audio' | 'image' | 'system'
  message_kind  TEXT NOT NULL DEFAULT 'text',
  read_by_customer_at TIMESTAMP,
  read_by_admin_at    TIMESTAMP,
  created_at    TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_direct_order_messages_order
  ON direct_order_messages (order_id, created_at DESC);

-- Backfill trigger: when a customer/admin posts a message, mark the
-- OPPOSITE side's read timestamp as NULL (so unread counts reset).
-- This is a hint for client-side optimistic UI; the canonical state
-- is computed from read_by_customer_at / read_by_admin_at at read time.

COMMIT;