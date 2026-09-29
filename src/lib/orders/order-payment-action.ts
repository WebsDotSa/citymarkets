/**
 * Server/client shared decision helper for "should this order surface a
 * payment or retry CTA in the customer UI?".
 *
 * Returns one of:
 *   - "pay"   → order is unpaid (or a non-online pending method) and the
 *               customer can choose to pay it electronically.
 *   - "retry" → a previous electronic attempt failed (or the order was
 *               auto-cancelled because payment init failed). Re-running
 *               the same payment method is the expected recovery.
 *   - "none"  → either already paid/settled, terminal (delivered/cancelled
 *               with no failure), refunded, or there is already an online
 *               attempt in flight.
 *
 * The logic intentionally fails closed on unknown values so a brand-new
 * backend status never silently exposes a broken CTA.
 */

export type OrderPaymentAction = "pay" | "retry" | "none";

export interface OrderPaymentActionInput {
  status: string | null | undefined;
  paymentStatus: string | null | undefined;
  paymentMethod: string | null | undefined;
}

/**
 * The set of online methods the /orders "pay / retry" CTA is allowed to
 * initiate. The "tamara" provider is an order-level BNPL choice made at
 * checkout and intentionally NOT in this list — repaying a Tamara order
 * is a manual support flow.
 *
 * `stc_pay` was removed from the operator-facing picker on 2026-09-20 —
 * it is intentionally absent here so a stale client cannot silently
 * re-introduce it. `bank_transfer` is also absent because manual bank
 * transfers are not retryable via this endpoint; the customer must
 * re-confirm through admin.
 */
export const ONLINE_RETRYABLE_METHODS = [
  "mada",
  "visa",
  "mastercard",
  "amex",
  "apple_pay",
] as const;

const TERMINAL_PAYMENT_STATUSES = new Set(["paid", "completed", "refunded"]);
const TERMINAL_ORDER_STATUSES = new Set(["delivered"]);
// Backend enum (multi-vendor) — drive any UI gating off this list. Unknown
// values (typos, brand-new statuses) must fail closed to "none" so a stale
// client never exposes a CTA for an order that no longer maps to anything.
const KNOWN_ORDER_STATUSES = new Set([
  "pending",
  "confirmed",
  "shopping",
  "on_the_way",
  "delivered",
  "cancelled",
  "paid",
]);

export function getOrderPaymentAction(
  input: OrderPaymentActionInput,
): OrderPaymentAction {
  const status = (input.status ?? "").toString().toLowerCase();
  const paymentStatus = (input.paymentStatus ?? "").toString().toLowerCase();
  const paymentMethod = (input.paymentMethod ?? "").toString().toLowerCase();

  if (!status || !paymentStatus) return "none";
  if (!KNOWN_ORDER_STATUSES.has(status)) return "none";

  if (TERMINAL_PAYMENT_STATUSES.has(paymentStatus)) return "none";
  if (TERMINAL_ORDER_STATUSES.has(status)) return "none";

  if (paymentStatus === "failed") {
    // cancelled+failed is the auto-cancel state created by checkout when
    // gateway init throws — surface retry so the customer can recover.
    if (status === "cancelled") return "retry";
    return "retry";
  }

  if (paymentStatus === "unpaid") {
    if (status === "cancelled") return "none";
    return "pay";
  }

  if (paymentStatus === "pending") {
    if (paymentMethod === "cash" || paymentMethod === "wallet") return "pay";
    return "none";
  }

  return "none";
}

export function isRetryableOrderPayment(
  input: OrderPaymentActionInput,
): boolean {
  return getOrderPaymentAction(input) === "retry";
}
