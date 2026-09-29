/**
 * Order ownership gate.
 *
 * SECURITY (F1): the legacy check was
 *
 *   if (order.user_id && order.user_id !== userId) → 403
 *
 * which silently let any caller through if the order was a guest order
 * (user_id IS NULL). The fix is a POSITIVE ownership proof:
 *
 *   1. Logged-in customer  → order.user_id === userId
 *   2. Guest               → order.idempotency_key === body's/query's key
 *
 * The idempotency_key is a 64-char secret minted at checkout and stored
 * on the order row. The guest keeps it in their localStorage (or the
 * track-order page returns it once for re-use); without it, they cannot
 * prove ownership of an order they created.
 *
 * Helper returns a discriminated result so the route can pick a status
 * code + message without re-implementing the same `if` ladder.
 */

import { PoolClient } from "pg";

export type OrderOwnership =
  | { ok: true; userId: string | null; status: string }
  | { ok: false; code: 404 | 403 | 401; error: string };

export interface OrderOwnershipInput {
  /** The order UUID from the URL path. */
  orderId: string;
  /** Authenticated user id (or null for guest callers). */
  userId: string | null;
  /**
   * Idempotency key supplied by the caller. For guest orders this MUST
   * match the stored key on the row. For logged-in users it's ignored.
   * Sources: query string (?key=...) for GET, request body field for
   * mutating verbs.
   */
  providedIdempotencyKey: string | null;
  /** Postgres client (already inside a transaction when relevant). */
  client: PoolClient;
  /**
   * SELECT clause for the columns we need. Defaults to the canonical
   * set; override only when the caller already fetched more columns.
   */
  select?: string;
}

const DEFAULT_SELECT = `id, user_id::text as user_id, status, idempotency_key`;

export async function assertOrderOwnership({
  orderId,
  userId,
  providedIdempotencyKey,
  client,
  select = DEFAULT_SELECT,
}: OrderOwnershipInput): Promise<OrderOwnership> {
  const ord = await client.query(
    `SELECT ${select} FROM orders WHERE id = $1 LIMIT 1`,
    [orderId]
  );
  if (ord.rows.length === 0) {
    return { ok: false, code: 404, error: "الطلب غير موجود" };
  }
  const row = ord.rows[0] as {
    user_id: string | null;
    status: string;
    idempotency_key: string | null;
  };

  // Branch 1: order belongs to a registered user. Ownership = the JWT's
  // user id matches. The previous code's failure mode was a missing
  // user_id on the row; we now go further and require explicit
  // user-id match here, with no "if user_id is null, skip" escape.
  if (row.user_id) {
    if (!userId) {
      return { ok: false, code: 403, error: "ليست لديك صلاحية" };
    }
    if (row.user_id !== userId) {
      return { ok: false, code: 403, error: "ليست لديك صلاحية" };
    }
    return { ok: true, userId, status: row.status };
  }

  // Branch 2: guest order. The caller MUST prove they minted the order
  // by presenting the same idempotency_key that the checkout route
  // stored on the row. A constant-time string compare prevents
  // timing-based enumeration of guest keys.
  if (
    typeof providedIdempotencyKey === "string" &&
    typeof row.idempotency_key === "string" &&
    row.idempotency_key.length > 0 &&
    providedIdempotencyKey.length > 0 &&
    timingSafeStrEqual(providedIdempotencyKey, row.idempotency_key)
  ) {
    return { ok: true, userId: null, status: row.status };
  }

  return { ok: false, code: 403, error: "ليست لديك صلاحية" };
}

function timingSafeStrEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Convenience: extract the idempotency key from a request body (POST/PATCH/DELETE).
 * Returns null if not a string or empty.
 */
export function idempotencyKeyFromBody(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const raw = (body as Record<string, unknown>).idempotency_key;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > 64) return null;
  return trimmed;
}

/**
 * Convenience: extract the idempotency key from a query string (GET).
 * Looks at both `key` and `idempotency_key` for client flexibility.
 */
export function idempotencyKeyFromQuery(url: URL): string | null {
  const raw = url.searchParams.get("key") ?? url.searchParams.get("idempotency_key");
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > 64) return null;
  return trimmed;
}
