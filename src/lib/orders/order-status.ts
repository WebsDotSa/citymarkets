/**
 * Re-export shim for the canonical order-status UI configuration.
 *
 * P2-1 (production hardening 2): the actual data + transition logic
 * now lives in `@/lib/orders/state-machine`. This file keeps the
 * historical export names (`ORDER_STATUSES`, `getOrderStatusConfig`,
 * `PAYMENT_STATUSES_CONFIG`, etc.) so all UI consumers continue to
 * import from `@/lib/orders/order-status` without breaking, while
 * the central state machine is the single source of truth.
 *
 * Adding a new status now requires:
 *   1. Migration adding the value to the Postgres enum
 *   2. Edit `@/lib/orders/state-machine.ts` (transition tables +
 *      display labels)
 *
 * Previously it required four edits (validation/order.ts, this file,
 * driver route, vendor route); the central file folds them into one.
 */

import {
  Clock,
  Check,
  RefreshCw,
  Truck,
  X,
  type LucideIcon,
} from "lucide-react";

import {
  ORDER_STATE_DISPLAY,
  VENDOR_ORDER_STATE_DISPLAY,
  PAYMENT_STATE_DISPLAY,
  type OrderState,
  type VendorOrderState,
  type PaymentState,
} from "./state-machine";

export type { OrderState, VendorOrderState, PaymentState };

export interface OrderStatusConfig {
  /** Arabic label rendered in badges / dropdowns */
  label: string;
  /** Tailwind classes for the badge background + text */
  color: string;
  /**
   * Inline-style-friendly hex color (see `OrderStateDisplay.hex` in
   * `state-machine.ts`). Defaults to `#6B7280` (gray-500) in the
   * `getOrderStatusConfig` fallback for unknown statuses.
   */
  hex: string;
  /** Lucide icon for the badge */
  icon: LucideIcon;
  /** Whether this status is considered "active" (i.e. not terminal) */
  active: boolean;
}

/**
 * Parent-order status config — UI labels re-exported from the central
 * state machine. Kept as a `Record<string, OrderStatusConfig>` (not
 * `Record<OrderState, …>`) so unknown backend values still hit the
 * safe-fallback in `getOrderStatusConfig` instead of crashing.
 */
export const ORDER_STATUSES: Record<string, OrderStatusConfig> =
  ORDER_STATE_DISPLAY as unknown as Record<string, OrderStatusConfig>;

/** Returns the status config for a status key, with a safe fallback. */
export function getOrderStatusConfig(status: string): OrderStatusConfig {
  return (
    ORDER_STATUSES[status] ?? {
      label: status,
      color: "bg-gray-100 text-gray-700",
      hex: "#6B7280",
      icon: Clock,
      active: true,
    }
  );
}

/** Active status keys, in display order, used by admin + customer filters. */
export const ACTIVE_ORDER_STATUSES: string[] = [
  "pending",
  "confirmed",
  "shopping",
  "on_the_way",
];

/** Display order used by status dropdowns (admin). */
export const ORDER_STATUS_DISPLAY: Array<{ value: string; label: string }> = (
  Object.entries(ORDER_STATE_DISPLAY) as Array<[string, OrderStatusConfig]>
)
  .filter(([key]) =>
    [
      "pending",
      "confirmed",
      "shopping",
      "on_the_way",
      "delivered",
      "cancelled",
    ].includes(key),
  )
  .map(([value, { label }]) => ({ value, label }));

/**
 * Progress steps for the customer-facing order timeline. Includes
 * "تم التأكيد" so the timeline is contiguous from order receipt to
 * delivery, and uses the canonical backend status values.
 */
export const CUSTOMER_PROGRESS_STEPS: Array<{
  label: string;
  status: string;
  icon: LucideIcon;
}> = [
  { label: "تم الاستلام", status: "pending", icon: Check },
  { label: "تم التأكيد", status: "confirmed", icon: Check },
  { label: "جارٍ التحضير", status: "shopping", icon: RefreshCw },
  { label: "في الطريق", status: "on_the_way", icon: Truck },
  { label: "تم التوصيل", status: "delivered", icon: Check },
];

export const PAYMENT_METHOD_AR: Record<string, string> = {
  cash: "نقداً عند الاستلام",
  mada: "مدى",
  visa: "فيزا",
  mastercard: "ماستركارد",
  apple_pay: "Apple Pay",
  stc_pay: "STC Pay",
  // Operator decision (2026-09-20): bank transfer added (Al Rajhi).
  bank_transfer: "تحويل بنكي",
  // Removed from picker but kept here for historical orders / analytics.
  tamara: "تمارا",
  wallet: "المحفظة",
};

export const PAYMENT_STATUS_AR: Record<string, string> = {
  // تم الدفع — confirmed paid (Moyasar / Apple Pay / Visa / مدى / STC Pay / نقداً)
  paid: "تم الدفع",
  // قيد تأكيد الدفع — gateway hasn't confirmed yet (online payment flow),
  // or cash-on-delivery before collection.
  pending: "قيد تأكيد الدفع",
  // فشل الدفع — gateway rejected (declined card, 3DS fail, expired invoice)
  failed: "فشل الدفع",
  // مبلغ مُعاد للعميل
  refunded: "مسترد",
};

/**
 * Canonical payment-status configuration shared by admin + customer panels.
 * Each entry provides:
 *   - label: localized human-readable text
 *   - color: Tailwind classes for the pill/badge background + text
 *   - dotColor: Tailwind class for the small status dot inside the pill
 *
 * `label` falls back to `PAYMENT_STATUS_AR` so unknown backend values still
 * render correctly. The `color`/`dotColor` fall back to neutral gray.
 *
 * P1-2 (full-system audit 2026-09-30): legacy `unpaid` and `completed`
 * aliases were removed — neither is ever written to the DB anymore
 * (P0-3 + analytics filter cleanup). The canonical set is
 * `{paid, pending, failed, refunded}`.
 */
export interface PaymentStatusConfig {
  label: string;
  color: string;
  dotColor: string;
}

export const PAYMENT_STATUSES_CONFIG: Record<string, PaymentStatusConfig> = {
  paid: {
    label: PAYMENT_STATUS_AR.paid,
    color: "bg-emerald-100 text-emerald-700",
    dotColor: "bg-emerald-500",
  },
  pending: {
    label: PAYMENT_STATUS_AR.pending,
    color: PAYMENT_STATE_DISPLAY.pending.color,
    dotColor: "bg-amber-500",
  },
  failed: {
    label: PAYMENT_STATUS_AR.failed,
    color: PAYMENT_STATE_DISPLAY.failed.color,
    dotColor: "bg-red-500",
  },
  refunded: {
    label: PAYMENT_STATUS_AR.refunded,
    color: PAYMENT_STATE_DISPLAY.refunded.color,
    dotColor: "bg-blue-500",
  },
};

/** Returns the payment status config with a safe fallback. */
export function getPaymentStatusConfig(status: string): PaymentStatusConfig {
  return (
    PAYMENT_STATUSES_CONFIG[status] ?? {
      label: PAYMENT_STATUS_AR[status] || status || "—",
      color: "bg-gray-100 text-gray-700",
      dotColor: "bg-gray-400",
    }
  );
}

// Re-export the vendor-order display map for vendor-side admin UIs.
export const VENDOR_ORDER_STATUSES: Record<string, OrderStatusConfig> =
  VENDOR_ORDER_STATE_DISPLAY as unknown as Record<string, OrderStatusConfig>;