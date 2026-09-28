import {
  Clock,
  Check,
  RefreshCw,
  Truck,
  X,
  type LucideIcon,
} from "lucide-react";

/**
 * Canonical order-status configuration shared between admin dashboard,
 * admin orders screens, and the customer-facing order history.
 *
 * Backend stores the value as `shopping` for "preparing". The UI exposes
 * the customer-facing label "جارٍ التحضير" everywhere so shoppers and
 * staff see the same wording regardless of where they look.
 */

export interface OrderStatusConfig {
  /** Arabic label rendered in badges / dropdowns */
  label: string;
  /** Tailwind classes for the badge background + text */
  color: string;
  /** Lucide icon for the badge */
  icon: LucideIcon;
  /** Whether this status is considered "active" (i.e. not terminal) */
  active: boolean;
}

export const ORDER_STATUSES: Record<string, OrderStatusConfig> = {
  pending: {
    label: "قيد الانتظار",
    color: "bg-amber-100 text-amber-700",
    icon: Clock,
    active: true,
  },
  confirmed: {
    label: "تم التأكيد",
    color: "bg-blue-100 text-blue-700",
    icon: Check,
    active: true,
  },
  // Backend enum value = `shopping`. Surfaced to humans as "جارٍ التحضير".
  shopping: {
    label: "جارٍ التحضير",
    color: "bg-purple-100 text-purple-700",
    icon: RefreshCw,
    active: true,
  },
  on_the_way: {
    label: "في الطريق",
    color: "bg-primary/10 text-primary",
    icon: Truck,
    active: true,
  },
  delivered: {
    label: "تم التوصيل",
    color: "bg-primary-100 text-primary-700",
    icon: Check,
    active: false,
  },
  cancelled: {
    label: "ملغي",
    color: "bg-red-100 text-red-700",
    icon: X,
    active: false,
  },
};

/** Returns the status config for a status key, with a safe fallback. */
export function getOrderStatusConfig(status: string): OrderStatusConfig {
  return (
    ORDER_STATUSES[status] ?? {
      label: status,
      color: "bg-gray-100 text-gray-700",
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
export const ORDER_STATUS_DISPLAY: Array<{ value: string; label: string }> = [
  { value: "pending", label: ORDER_STATUSES.pending.label },
  { value: "confirmed", label: ORDER_STATUSES.confirmed.label },
  { value: "shopping", label: ORDER_STATUSES.shopping.label },
  { value: "on_the_way", label: ORDER_STATUSES.on_the_way.label },
  { value: "delivered", label: ORDER_STATUSES.delivered.label },
  { value: "cancelled", label: ORDER_STATUSES.cancelled.label },
];

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
  completed: "تم الدفع",
  // لم يتم الدفع — gateway hasn't confirmed yet (online payment flow), or
  // cash-on-delivery before collection. Surfaces to customers as "not yet paid".
  unpaid: "لم يتم الدفع",
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
  completed: {
    label: PAYMENT_STATUS_AR.completed,
    color: "bg-emerald-100 text-emerald-700",
    dotColor: "bg-emerald-500",
  },
  unpaid: {
    label: PAYMENT_STATUS_AR.unpaid,
    color: "bg-gray-100 text-gray-700",
    dotColor: "bg-gray-400",
  },
  pending: {
    label: PAYMENT_STATUS_AR.pending,
    color: "bg-amber-100 text-amber-700",
    dotColor: "bg-amber-500",
  },
  failed: {
    label: PAYMENT_STATUS_AR.failed,
    color: "bg-red-100 text-red-700",
    dotColor: "bg-red-500",
  },
  refunded: {
    label: PAYMENT_STATUS_AR.refunded,
    color: "bg-blue-100 text-blue-700",
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