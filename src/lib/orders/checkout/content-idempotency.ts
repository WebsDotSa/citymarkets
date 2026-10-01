// Content-derived idempotency key for checkout requests.
//
// PCP-83 (Audit of PCP-77 finding #5):
// `create-checkout.ts` only catches replays that share the EXACT same
// `idempotency_key`. A client retry without the key — e.g. a user
// whose mobile flaked, dropped the network, and resubmitted before
// the SPA could rehydrate the cached UUID — would burn the coupon
// twice and decrement stock twice.
//
// This helper computes a STABLE, server-side key from the request
// contents + caller identity, truncated to a 60-second window. Any
// two submissions of the same cart, by the same caller, within the
// same minute collapse to the same key — and the existing
// `orders.idempotency_key` UNIQUE constraint (migration 034) +
// `vendor_orders.idempotency_key` UNIQUE constraint (migration 038)
// replay the first insert as a duplicate instead of burning the
// coupon a second time.
//
// WHY ONE MINUTE: large enough that a flaky network retry and a
// user-click retry both collapse, small enough that the same user
// legitimately checking out the same cart 90s later creates a fresh
// order. The window is documented in `create-checkout.ts` header
// and pinned by this module's unit test.
//
// WHY INCLUDE THE CALLER IDENTITY (user_id or guest session id):
// without it, two different customers who happen to have identical
// carts in the same minute would collide. Phone alone is weaker
// (relies on phone being stable across visits) so user_id + session
// is the canonical identity; phone is only the fallback when both
// are missing (shouldn't happen for /api/v1/checkout because the
// route already 401s without either).
//
// WHY SORT CART ITEMS BEFORE HASHING: client may emit items in any
// order across two requests (React state updates are not
// deterministic). Sorting by (vendor_id then product_id) makes the
// serialization canonical so two semantically-identical carts hash
// to the same key.

import { createHash } from "node:crypto";

/** Truncation window — see header. */
export const IDEMPOTENCY_WINDOW_MS = 60_000;

/** Caller identity after the route has resolved auth + guest session. */
export interface IdempotencyCaller {
  userId: string | null;
  sessionId: string | null;
  /** Guest phone — last-resort identity, only used when neither userId nor sessionId is set. */
  guestPhone?: string | null;
}

/**
 * Validated cart shape — anything that affects the order semantics.
 * Pulled from `lib/validation/checkout.ts` (multiVendorCheckoutSchema).
 */
export interface IdempotencyCart {
  items?: Array<{ product_id: string; quantity: number }>;
  vendor_groups?: Array<{
    vendor_id: string;
    items: Array<{ product_id: string; quantity: number }>;
  }>;
}

/**
 * Compute a content-derived idem key. Returns null when the cart has
 * no items (caller should treat as a regular 400 via the upstream
 * validator's superRefine).
 */
export function deriveContentIdempotencyKey(args: {
  cart: IdempotencyCart;
  caller: IdempotencyCaller;
  /** Server now() — pass an explicit value for deterministic tests. */
  now?: Date;
}): string | null {
  const { cart, caller } = args;
  const now = args.now ?? new Date();

  // Canonical line list. We only hash what's load-bearing — quantity
  // and product/vendor ids. Notes, address, payment method, etc. are
  // NOT included: those are post-coupon concerns and a retry with a
  // different address should fail business validation, not collapse.
  const lines: string[] = [];
  for (const it of cart.items ?? []) {
    lines.push(`catalog:${it.product_id}:${it.quantity}`);
  }
  for (const g of cart.vendor_groups ?? []) {
    for (const it of g.items) {
      lines.push(`vendor:${g.vendor_id}:${it.product_id}:${it.quantity}`);
    }
  }
  if (lines.length === 0) return null;

  lines.sort(); // canonical order — see header.

  // Truncate to the minute (window starts at the start of the minute
  // that contains `now`). Date.getTime() in ms; floor-divide by window.
  const minuteStart = Math.floor(now.getTime() / IDEMPOTENCY_WINDOW_MS) *
    IDEMPOTENCY_WINDOW_MS;

  const identity =
    caller.userId ??
    (caller.sessionId ? `session:${caller.sessionId}` : null) ??
    (caller.guestPhone ? `guest:${caller.guestPhone}` : null);
  if (!identity) return null;

  const payload = [
    `window=${new Date(minuteStart).toISOString()}`,
    `identity=${identity}`,
    ...lines,
  ];

  return createHash("sha256").update(payload.join("\n")).digest("hex");
}