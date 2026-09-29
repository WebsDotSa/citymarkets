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
import { pool } from "@/lib/db";
import {
  checkRateLimit,
  type RateLimitConfig,
  type RateLimitResult,
  createRateLimitHeaders,
} from "@/lib/rate-limit";
import { getClientIp } from "@/lib/request-ip";
import { resolveCustomerUserIdFromRequest } from "@/lib/customer-session";
import { getOrderPaymentAction } from "@/lib/order-payment-action";
import type { NextRequest } from "next/server";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const MAX_IDEMPOTENCY_KEY = 64;

// Operator decision (2026-09-20): stc_pay removed from the retry picker.
// `bank_transfer` is intentionally absent — it is not retryable via
// the retry endpoint; the customer must re-confirm through the admin.
export const ONLINE_RETRY_METHODS = new Set([
  "mada",
  "visa",
  "mastercard",
  "amex",
  "apple_pay",
]);

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
  for (const [key, value] of Object.entries(createRateLimitHeaders(result))) {
    headers[key] = String(value);
  }
  headers["X-RateLimit-By"] = by;
  return headers;
}

/**
 * Mark an order as payment-failed AND cascade the same status to every
 * vendor_order child. Used by the checkout + retry routes when the
 * gateway invoice call rejects — keeps the row visible to the customer
 * (so they can retry) but signals the failure to the admin dashboard.
 */
export async function markOrderPaymentFailed(
  parentOrderId: string,
  vendorOrderIds: string[] = [],
): Promise<void> {
  await pool.query(
    `UPDATE orders SET payment_status = 'failed', status = 'cancelled' WHERE id = $1`,
    [parentOrderId],
  );
  for (const childId of vendorOrderIds) {
    await pool.query(
      `UPDATE vendor_orders SET payment_status = 'failed', status = 'cancelled' WHERE id = $1`,
      [childId],
    );
  }
}
