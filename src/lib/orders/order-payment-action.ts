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
import { ONLINE_RETRY_METHODS } from "@/lib/payments/payment-methods";
import {
  ALL_ORDER_STATES,
  TERMINAL_PAYMENT_STATUSES,
} from "./state-machine";

export type OrderPaymentAction = "pay" | "retry" | "none";

export interface OrderPaymentActionInput {
  status: string | null | undefined;
  paymentStatus: string | null | undefined;
  paymentMethod: string | null | undefined;
}

// D16-D19 cleanup (2026-09-30): the legacy `ONLINE_RETRYABLE_METHODS`
// alias was removed. Canonical source is `ONLINE_RETRY_METHODS` in
// `@/lib/payments/payment-methods`.
//
// 2026-10-04 (refactor/full-repository-consolidation): `KNOWN_ORDER_STATUSES`
// was removed — the legacy `"paid"` alias was a stray (payment status ≠
// order fulfillment status; see state-machine.ts:20 for the split).
// Validation now derives directly from `ALL_ORDER_STATES` so a new
// `OrderState` automatically lights up here. The terminal sets moved
// into `state-machine.ts` so admin/driver/vendor routes reuse them
// (see `DRIVER_VISIBLE_STATUSES`, `ADMIN_VISIBLE_STATUSES`).

export function getOrderPaymentAction(
  input: OrderPaymentActionInput,
): OrderPaymentAction {
  const status = (input.status ?? "").toString().toLowerCase();
  const paymentStatus = (input.paymentStatus ?? "").toString().toLowerCase();
  const paymentMethod = (input.paymentMethod ?? "").toString().toLowerCase();

  if (!status || !paymentStatus) return "none";
  if (!ALL_ORDER_STATES.includes(status as (typeof ALL_ORDER_STATES)[number])) {
    return "none";
  }

  if (TERMINAL_PAYMENT_STATUSES.has(paymentStatus as Parameters<typeof TERMINAL_PAYMENT_STATUSES.has>[0])) {
    return "none";
  }
  // Only "delivered" is terminal-no-CTA here — "cancelled" is intentionally
  // NOT checked because the failed-payment handler below recovers the
  // auto-cancelled-when-gateway-throws case by surfacing a retry CTA.
  if (status === "delivered") return "none";

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
