/**
 * UI display configuration for order, vendor-order, and payment states.
 *
 * Audit C10 (Phase 10 state-machine split): these display maps were
 * previously inline in `state-machine.ts` (lines 333-486) which pulled
 * `lucide-react` into the canonical domain source. The split lets the
 * domain state-machine file stay pure (no UI deps) while this file
 * owns the UI presentation layer.
 *
 * Consumers:
 *   - Components that render status pills / dropdowns / badges import
 *     directly from this file.
 *   - `state-machine.ts` re-exports the same symbols for backward
 *     compatibility; new code should prefer importing from here.
 */
import type { LucideIcon } from "lucide-react";
import { Check, Clock, RefreshCw, Truck, X } from "lucide-react";
import type {
  OrderState,
  VendorOrderState,
  PaymentState,
} from "./state-machine";
import { BRAND } from "@/lib/brand-theme";

export interface OrderStateDisplay {
  label: string;
  color: string;
  /**
   * Inline-style-friendly hex color. Useful for inline `style={{ color }}`
   * and `style={{ backgroundColor: ${hex}20 }}` (the trailing `20` is
   * a 12% alpha overlay) where Tailwind classes can't be applied.
   * Sourced from the legacy `STATUS_COLORS` maps that previously lived
   * inline in `direct-order/*` pages — kept here so the canonical UI
   * config owns both class and hex forms.
   */
  hex: string;
  icon: LucideIcon;
  active: boolean;
}

export const ORDER_STATE_DISPLAY: Readonly<Record<OrderState, OrderStateDisplay>> = {
  pending: {
    label: "قيد الانتظار",
    color: "bg-amber-100 text-amber-700",
    hex: "#F59E0B",
    icon: Clock,
    active: true,
  },
  confirmed: {
    label: "تم التأكيد",
    color: "bg-blue-100 text-blue-700",
    hex: "#1D4ED8",
    icon: Check,
    active: true,
  },
  shopping: {
    label: "جارٍ التحضير",
    color: "bg-purple-100 text-purple-700",
    hex: "#3B82F6",
    icon: RefreshCw,
    active: true,
  },
  on_the_way: {
    label: "في الطريق",
    color: "bg-primary/10 text-primary",
    hex: "#0EA5E9",
    icon: Truck,
    active: true,
  },
  delivered: {
    label: "تم التوصيل",
    color: "bg-primary-100 text-primary-700",
    hex: "#007A38",
    icon: Check,
    active: false,
  },
  cancelled: {
    label: "ملغي",
    color: "bg-red-100 text-red-700",
    hex: "#EF4444",
    icon: X,
    active: false,
  },
};

export const VENDOR_ORDER_STATE_DISPLAY: Readonly<
  Record<VendorOrderState, OrderStateDisplay>
> = {
  pending: {
    label: "بانتظار التأكيد",
    color: "bg-amber-100 text-amber-700",
    hex: "#F59E0B",
    icon: Clock,
    active: true,
  },
  confirmed: {
    label: "تم التأكيد",
    color: "bg-blue-100 text-blue-700",
    hex: "#1D4ED8",
    icon: Check,
    active: true,
  },
  preparing: {
    label: "جارٍ التحضير",
    color: "bg-purple-100 text-purple-700",
    hex: "#3B82F6",
    icon: RefreshCw,
    active: true,
  },
  ready: {
    label: "جاهز للتوصيل",
    color: "bg-indigo-100 text-indigo-700",
    hex: "#8B5CF6",
    icon: Check,
    active: true,
  },
  out_for_delivery: {
    label: "خرج للتوصيل",
    color: "bg-primary/10 text-primary",
    hex: "#0EA5E9",
    icon: Truck,
    active: true,
  },
  delivered: {
    label: "تم التوصيل",
    color: "bg-primary-100 text-primary-700",
    hex: "#007A38",
    icon: Check,
    active: false,
  },
  cancelled: {
    label: "ملغي",
    color: "bg-red-100 text-red-700",
    hex: "#EF4444",
    icon: X,
    active: false,
  },
  refunded: {
    label: "مسترد",
    color: "bg-blue-100 text-blue-700",
    hex: "#6B7280",
    icon: RefreshCw,
    active: false,
  },
};

export const PAYMENT_STATE_DISPLAY: Readonly<
  Record<PaymentState, OrderStateDisplay>
> = {
  pending: {
    label: "قيد تأكيد الدفع",
    color: "bg-amber-100 text-amber-700",
    hex: "#F59E0B",
    icon: Clock,
    active: true,
  },
  paid: {
    label: "تم الدفع",
    color: "bg-primary-100 text-primary-700",
    hex: "#007A38",
    icon: Check,
    active: false,
  },
  failed: {
    label: "فشل الدفع",
    color: "bg-red-100 text-red-700",
    hex: "#EF4444",
    icon: X,
    active: false,
  },
  refunded: {
    label: "مسترد",
    color: "bg-blue-100 text-blue-700",
    hex: "#6B7280",
    icon: RefreshCw,
    active: false,
  },
};
