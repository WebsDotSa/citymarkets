-- ══════════════════════════════════════════════════════════════
-- 075 — Admin notification read-state persistence (D6)
--
-- The admin notifications PUT handler previously returned a no-op
-- success ("Read-state is currently per-session (computed)") — every
-- "Mark as read" / "Mark all read" reverted on page reload.
--
-- This migration adds the persisted read-state table that the PUT
-- handler can write to. The `notification_id` column uses a TEXT
-- (not UUID) type because the GET handler synthesizes IDs like
-- `order-<uuid>`, `lowstock-<uuid>`, `outstock-<uuid>` — these are
-- derived keys, not primary keys of any real table.
--
-- Forward-only. No backfill required (legacy read state is lost —
-- the previous behavior was already ephemeral).
-- ══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS admin_notification_reads (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  admin_id UUID NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  -- Synthetic notification key from `admin/notifications` GET
  -- (`order-<uuid>`, `lowstock-<uuid>`, `outstock-<uuid>`).
  notification_id TEXT NOT NULL,
  read_at TIMESTAMP DEFAULT NOW() NOT NULL,
  UNIQUE (admin_id, notification_id)
);

CREATE INDEX IF NOT EXISTS idx_admin_notification_reads_admin
  ON admin_notification_reads (admin_id);

CREATE INDEX IF NOT EXISTS idx_admin_notification_reads_lookup
  ON admin_notification_reads (admin_id, notification_id);