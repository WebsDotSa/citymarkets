// PaymentService — shared helpers for the customer-facing payment
// endpoints (POST /api/v1/payments/initiate + /retry + /status).
//
// Pulled out of the individual route handlers in 2026-09-28 because the
// three routes repeated the same 9-step pipeline:
//
//   1. Resolve customer userId from request
//   2. Per-user + per-IP rate limit
//   3. Parse body
//   4. Validate orderId UUID
//   5. Open transaction, SELECT ... FOR UPDATE the parent row
//   6. Authorize (order.user_id === caller userId, or 403)
//   7. Compute the action (none / pay / retry) from order.status +
//      payment_status + payment_method
//   8. Load server-authoritative total
//   9. Initiate gateway invoice (Moyasar / Tamara)
//
// Every helper returns a discriminated-union result so the routes
// stay thin (no try/catch around pool, no manual JSON mapping for
// 401/403/404/409). The pattern mirrors CheckoutService in
// src/lib/checkout/checkout-service.ts.

import type { PoolClient } from "pg";
import type { RateLimitConfig, RateLimitResult } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/request-ip";
import { resolveCustomerUserIdFromRequest } from '@/lib/identity';
import { getOrderPaymentAction } from '@/lib/orders';
import type { NextRequest } from "next/server";

// Inlined from `@/lib/rate-limit` so this module can avoid a top-level
// dep on the redis client (`@redis/client`). The barrel `@/lib/payments`
// is imported by client components (bank-transfer-card.tsx → BANK_TRANSFER_DETAILS);
// keeping redis out of that path matters for the Turbopack build.
function buildRateLimitHeaders(result: RateLimitResult): Record<string, string> {
  const headers: Record<string, string> = {
    "X-RateLimit-Remaining": result.remaining.toString(),
    "X-RateLimit-Reset": result.resetAt.toString(),
  };
  if (!result.allowed && result.retryAfterMs) {
    headers["Retry-After"] = Math.ceil(result.retryAfterMs / 1000).toString();
  }
  return headers;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const MAX_IDEMPOTENCY_KEY = 64;

// D16-D19 cleanup (2026-09-30): the legacy `ONLINE_RETRY_METHODS` alias
// re-export has been removed. Canonical source is `@/lib/payments/payment-methods`.

export type PaymentServiceResult<T> =
  | { kind: "ok"; value: T }
  | { kind: "unauthorized" }
  | { kind: "rate_limited"; by: "user" | "ip"; result: RateLimitResult }
  | { kind: "bad_request"; error: string }
  | { kind: "not_found" }
  | { kind: "forbidden" }
  | { kind: "conflict"; error: string }
  | { kind: "ineligible"; error: string }
  | { kind: "invalid_total" }
  | { kind: "internal_error"; error?: string };

export interface AuthorizedOrder {
  client: PoolClient;
  owner: OwnerSnapshot;
  serverTotal: number;
}

/**
 * Resolve the caller from the request. Returns `null` when no customer
 * userId is present (unauthenticated request — caller should 401).
 */
export async function resolveCaller(request: NextRequest): Promise<string | null> {
  return resolveCustomerUserIdFromRequest(request);
}

/**
 * Apply per-user + per-IP rate limit. Distinct buckets so the two
 * never collapse into one. Returns the FIRST failure as a discriminated
 * result so the caller can map to a 429 with the right "by" header.
 */
export async function applyPaymentRateLimits(
  request: NextRequest,
  userId: string,
  userConfig: RateLimitConfig,
  ipConfig: RateLimitConfig,
): Promise<
  | { kind: "ok" }
  | { kind: "rate_limited"; by: "user" | "ip"; result: RateLimitResult }
> {
  // Dynamic imports keep pg + redis out of the client/edge bundle. This
  // file is re-exported from `@/lib/payments`, which client components
  // (e.g. bank-transfer-card.tsx → BANK_TRANSFER_DETAILS) import from.
  const { checkRateLimit } = await import("@/lib/rate-limit");
  const userLimit = await checkRateLimit(userId, userConfig);
  if (!userLimit.allowed) {
    return { kind: "rate_limited", by: "user", result: userLimit };
  }
  const clientIp = getClientIp(request);
  const ipLimit = await checkRateLimit(clientIp, ipConfig);
  if (!ipLimit.allowed) {
    return { kind: "rate_limited", by: "ip", result: ipLimit };
  }
  return { kind: "ok" };
}

/**
 * Parse the JSON body and validate that the required string fields are
 * present. Returns `null` on parse failure so the caller can 400.
 */
export async function parsePaymentBody(
  request: NextRequest,
): Promise<unknown> {
  try {
    const body = await request.json();
    if (!body || typeof body !== "object") return null;
    return body;
  } catch {
    return null;
  }
}

/**
 * Validate an orderId is a UUID-shaped string. Returns the value
 * itself on success so the caller doesn't have to cast twice.
 */
export function validateOrderId(orderId: unknown): string | null {
  if (typeof orderId !== "string" || !UUID_RE.test(orderId)) return null;
  return orderId;
}

interface OwnerSnapshot {
  id: string;
  user_id: string | null;
  total: string | number;
  payment_status: string;
  status: string;
  payment_method: string;
  guest_name: string | null;
  guest_phone: string | null;
  guest_email: string | null;
}

/**
 * Open a transaction, lock the parent order row (SELECT ... FOR UPDATE),
 * authorize ownership, and return the row + the server-authoritative
 * total. The transaction stays open — the caller commits or rolls back
 * when the gateway invoice call completes (success or failure).
 *
 * Caller is responsible for `client.release()` in a `finally` block.
 *
 * `skipActionCheck` opts out of the `getOrderPaymentAction` eligibility
 * check. The /initiate endpoint sets this because it accepts ANY
 * non-paid order (cash/wallet/pending/unpaid all valid); the /retry
 * endpoint leaves it on because retry only makes sense for orders that
 * are explicitly in a retryable state.
 */
export async function authorizeOrderForPayment(args: {
  orderId: string;
  userId: string;
  skipActionCheck?: boolean;
}): Promise<
  | { kind: "ok"; value: AuthorizedOrder }
  | { kind: "not_found" }
  | { kind: "forbidden" }
  | { kind: "ineligible"; error: string }
  | { kind: "invalid_total" }
> {
  const { pool } = await import("@/lib/db");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const r = await client.query<OwnerSnapshot>(
      `SELECT id, user_id::text AS user_id, total::text AS total,
              payment_status, status, payment_method,
              guest_name, guest_phone, guest_email
         FROM orders
        WHERE id = $1
        FOR UPDATE`,
      [args.orderId],
    );
    if (r.rows.length === 0) {
      await client.query("ROLLBACK");
      return { kind: "not_found" };
    }
    const owner = r.rows[0];
    if (String(owner.user_id ?? "") !== args.userId) {
      await client.query("ROLLBACK");
      // Avoid leaking ownership info; for guest orders user_id is
      // null and the comparison fails — fall through to not_found
      // so the caller doesn't leak whether the order exists.
      if (owner.user_id === null) return { kind: "not_found" };
      return { kind: "forbidden" };
    }
    if (!args.skipActionCheck) {
      const action = getOrderPaymentAction({
        status: owner.status,
        paymentStatus: owner.payment_status,
        paymentMethod: owner.payment_method,
      });
      if (action === "none") {
        await client.query("ROLLBACK");
        return {
          kind: "ineligible",
          error: "لا يمكن إعادة محاولة الدفع على هذا الطلب",
        };
      }
    }
    const serverTotal = Number(owner.total);
    if (!Number.isFinite(serverTotal) || serverTotal <= 0) {
      await client.query("ROLLBACK");
      return { kind: "invalid_total" };
    }
    return { kind: "ok", value: { client, owner, serverTotal } };
  } catch {
    await client.query("ROLLBACK");
    client.release();
    return { kind: "invalid_total" };
  }
}

/**
 * Commit the order-locking transaction opened by
 * `authorizeOrderForPayment`. Releases the client. Use this on the
 * happy path AFTER the gateway invoice call returns success.
 */
export async function commitOrderLock(auth: AuthorizedOrder): Promise<void> {
  try {
    await auth.client.query("COMMIT");
  } finally {
    auth.client.release();
  }
}

/**
 * Roll back the order-locking transaction and release the client. Use
 * this when the gateway invoice call FAILS — the parent row stays in
 * its pre-lock state so the customer can retry.
 */
export async function rollbackOrderLock(auth: AuthorizedOrder): Promise<void> {
  try {
    await auth.client.query("ROLLBACK");
  } catch {
    /* ignore */
  } finally {
    auth.client.release();
  }
}

/**
 * Helper that converts a PaymentServiceResult into the headers object
 * the routes attach to a 429 response. Kept in the service so the
 * `X-RateLimit-By` header stays consistent across all payment routes.
 */
export function rateLimitResponseHeaders(
  by: "user" | "ip",
  result: RateLimitResult,
): HeadersInit {
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(buildRateLimitHeaders(result))) {
    headers[key] = String(value);
  }
  headers["X-RateLimit-By"] = by;
  return headers;
}

/**
 * Mark an order's payment_status as failed and cascade the same to every
 * vendor_order child. Used by the checkout + retry routes when the
 * gateway invoice call rejects.
 *
 * FIX (P0-5): previously this also wrote `status = 'cancelled'`, which
 * collapsed the invariant that `payment_status` and `status` are
 * independent axes. A customer whose Moyasar session failed to open a
 * checkout URL had their order marked cancelled even though they could
 * still retry. Worse, vendor children were force-cancelled without
 * restocking — once a vendor started preparing, the cook never knew to
 * stop. The retry route (`/api/v1/payments/retry`) now handles the
 * lifecycle flip on its own.
 *
 * NOTE: this writes ONLY payment_status. The retry route is responsible
 * for any status column change (it explicitly sets `status='pending'`
 * before opening a new gateway session).
 */
export async function markOrderPaymentFailed(
  parentOrderId: string,
  vendorOrderIds: string[] = [],
): Promise<void> {
  const { pool } = await import("@/lib/db");
  // SECURITY / data-consistency (defence-in-depth 2026-10-08): release
  // the loyalty `pending_redeem` hold when payment fails. Without this
  // step the customer's effective balance is held until manual
  // reconciliation, causing the "available points" preview to drift
  // downward over time as failed-checkout attempts accumulate.
  const { releaseRedeemHoldForOrder } = await import("@/lib/orders/loyalty");
  await pool.query(
    `UPDATE orders SET payment_status = 'failed' WHERE id = $1`,
    [parentOrderId],
  );
  for (const childId of vendorOrderIds) {
    await pool.query(
      `UPDATE vendor_orders SET payment_status = 'failed' WHERE id = $1`,
      [childId],
    );
  }
  // Idempotent: if no hold exists (e.g. loyalty wasn't used on this
  // order, or it was already released), this is a no-op.
  try {
    await releaseRedeemHoldForOrder((await import("@/lib/db")).pool, {
      orderId: parentOrderId,
    });
  } catch (err) {
    // Don't fail the whole markOrderPaymentFailed call if loyalty
    // cleanup errors — the payment_status is the source of truth, the
    // hold release is best-effort cleanup.
    const { warn: logWarn } = await import("@/lib/logger");
    logWarn(
      "Failed to release pending_redeem hold on payment failure",
      { parentOrderId, error: (err as Error)?.message ?? String(err) },
    );
  }
}
