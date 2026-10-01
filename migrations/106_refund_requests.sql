-- Migration 106: refund_requests table for PCP-82 refund API.
--
-- Stores customer-initiated refund requests. The customer endpoint
-- `POST /api/v1/orders/[id]/refund` inserts a row with status='pending';
-- the admin endpoint `POST /api/admin/orders/[id]/refund` flips status
-- to 'approved' after the Moyasar refund call succeeds (and 'rejected'
-- on admin rejection).
--
-- A UNIQUE partial index on (order_id) WHERE status IN ('pending','approved')
-- guarantees a customer cannot file two pending requests against the
-- same order, while still allowing a fresh request after a previous
-- one is 'rejected' or 'completed'.
--
-- All idempotency / dedup logic lives in the partial index. The API
-- route FOR UPDATEs the row before INSERT to serialize two simultaneous
-- requests behind the lock.

CREATE TABLE IF NOT EXISTS refund_requests (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id              UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  requested_by_user_id  UUID REFERENCES users(id) ON DELETE SET NULL,
  reason                TEXT,
  status                TEXT NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending','approved','rejected','completed','failed')),
  gateway_refund_id     TEXT,
  refund_amount_halalas BIGINT,
  error_message         TEXT,
  approved_by_user_id   UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at          TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_refund_requests_order_active
  ON refund_requests (order_id)
  WHERE status IN ('pending','approved');

CREATE INDEX IF NOT EXISTS ix_refund_requests_status
  ON refund_requests (status, created_at DESC)
  WHERE status = 'pending';

COMMENT ON TABLE refund_requests IS
  'Customer-initiated refund requests. The customer endpoint inserts pending; admin endpoint flips to approved/rejected after gateway call. (PCP-82)';

-- Idempotent grant + RLS bypass for citymarket_user (matches migration 105).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'citymarket_user') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON refund_requests TO citymarket_user;
    ALTER TABLE refund_requests ENABLE ROW LEVEL SECURITY;
    -- Citymarket uses owner-scoped policies elsewhere; refund_requests has no
    -- customer-side PII (no card data), so a single permissive policy for the
    -- app role is sufficient. Admin reads/writes go through requireAdminApi.
    DROP POLICY IF EXISTS refund_requests_app_rw ON refund_requests;
    CREATE POLICY refund_requests_app_rw ON refund_requests
      FOR ALL TO citymarket_user
      USING (true) WITH CHECK (true);
  END IF;
END
$$;