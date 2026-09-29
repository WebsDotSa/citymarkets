-- Migration 076: server-backed wishlist persistence
--
-- Why this exists:
--   The wishlist was previously localStorage-only (P2-4). The
--   problems with localStorage:
--     - Refresh from another device loses the list
--     - Switching browsers (mobile -> desktop) loses the list
--     - Cart recovery flow can't surface wishlist items
--     - Cross-user isolation requires key namespacing (D4)
--     - Capacity caps are per-browser, not per-user
--
-- Design:
--   - wishlist_items: per-user rows of (user_id, product_id, added_at)
--   - UNIQUE on (user_id, product_id) so duplicate adds short-circuit
--   - ON DELETE CASCADE on user_id so account deletion cleans up
--   - ON DELETE RESTRICT on product_id so a soft-deleted product
--     doesn't auto-remove wishlist entries (operators can still see
--     "this product was in their wishlist" before deletion)
--
-- Note: wishlist does NOT track quantity or variant — each product
-- is either in the wishlist or not. Quantity changes happen at the
-- cart layer.

CREATE TABLE IF NOT EXISTS wishlist_items (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id  UUID NOT NULL REFERENCES products_unified(id) ON DELETE RESTRICT,
  added_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, product_id)
);

-- Index for the hot path: "list my wishlist, newest first"
CREATE INDEX IF NOT EXISTS idx_wishlist_items_user_added
  ON wishlist_items(user_id, added_at DESC);

-- Comment for future readers / migrations
COMMENT ON TABLE wishlist_items IS
  'Server-backed wishlist persistence (P2-4). One row per (user, product).';
