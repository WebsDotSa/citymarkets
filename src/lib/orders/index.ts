/**
 * Public barrel for the Orders bounded context.
 *
 * Phase 10.4 (domain-modules refactor): extracted from `src/lib/` root to
 * give checkout, order lifecycle, payment actions, loyalty, abandoned
 * carts, and pricing a clear home.
 *
 * IMPORTANT: this barrel is safe to import from client components. It
 * does NOT re-export anything that transitively pulls in `pg`, BullMQ,
 * or Redis (those would break Next.js client bundles). Server-only
 * helpers live behind deep-import paths:
 *
 *   - `@/lib/orders/checkout/checkout-service` — runCheckout
 *   - `@/lib/orders/checkout/create-checkout`  — createCheckout
 *   - `@/lib/orders/checkout/resolve-items`    — resolveItems
 *   - `@/lib/orders/checkout/resolve-address`  — pickUserAddress
 *   - `@/lib/orders/checkout/pricing`          — computeCheckoutTotals (DB-backed)
 *   - `@/lib/orders/loyalty`                   — earn/redeem (PoolClient)
 *   - `@/lib/orders/abandoned-carts`           — markAbandonedCartRecovered (DB)
 *   - `@/lib/orders/order-notify-admin`        — notifyAdminNewOrder (DB)
 *
 * Internal organization:
 *   - order-status.ts           — canonical status enums + Arabic labels
 *   - order-ownership.ts        — assert caller owns the order
 *   - order-paid-confirm.ts     — build + send "order paid" SMS (no DB)
 *   - order-metrics.ts          — revenue SQL/constants
 *   - order-payment-action.ts   — determine retry-ability of failed orders
 *   - pricing.ts                — order fee calculator (pure functions)
 *   - checkout/pricing.ts       — pure per-vendor checkout pricing
 */

// ── Order status (canonical enums + Arabic labels) ──────────────────────
export {
  ACTIVE_ORDER_STATUSES,
  CUSTOMER_PROGRESS_STEPS,
  getOrderStatusConfig,
  getPaymentStatusConfig,
  ORDER_STATUSES,
  ORDER_STATUS_DISPLAY,
  PAYMENT_METHOD_AR,
  PAYMENT_STATUS_AR,
  PAYMENT_STATUSES_CONFIG,
} from "./order-status";
export type { OrderStatusConfig, PaymentStatusConfig } from "./order-status";

// ── Order state machine (transitions + assertions) ─────────────────────
// Pure functions — safe to import from client components for filtering
// dropdown options.
export {
  ALL_ORDER_STATES,
  ALL_PAYMENT_STATES,
  ALL_VENDOR_ORDER_STATES,
  assertValidTransition,
  canTransition,
  invalidTransitionMessage,
  InvalidTransitionError,
} from "./state-machine";
export type {
  OrderState,
  PaymentState,
  Role,
  VendorOrderState,
} from "./state-machine";

// ── Order ownership (assertions — use only in route handlers) ──────────
export {
  assertOrderOwnership,
  idempotencyKeyFromBody,
  idempotencyKeyFromQuery,
} from "./order-ownership";
export type { OrderOwnership, OrderOwnershipInput } from "./order-ownership";

// ── Order paid confirmation SMS (pure SMS body builder) ────────────────
export {
  buildOrderPaidConfirmationBody,
  sendOrderPaidConfirmationSms,
} from "./order-paid-confirm";

// ── Order revenue metrics ───────────────────────────────────────────────
export {
  countsAsElectronicRevenue,
  isElectronicPaymentMethod,
  REVENUE_ORDER_STATUS,
  REVENUE_PAYMENT_STATUS,
  SQL_REVENUE_ELIGIBLE,
} from "./order-metrics";

// ── Order payment action (retry-ability — pure) ────────────────────────
export {
  getOrderPaymentAction,
  isRetryableOrderPayment,
} from "./order-payment-action";
export type {
  OrderPaymentAction,
  OrderPaymentActionInput,
} from "./order-payment-action";

// ── Pricing (order fees — pure functions) ───────────────────────────────
export {
  computeCouponDiscount,
  computeLoyaltyRedemption,
  computeOrderFees,
} from "./pricing";
export type {
  CouponRow,
  FeeBreakdown,
  LoyaltyRedemptionSettings,
  PricingSettings,
} from "./pricing";

// ── Checkout pricing (per-vendor — pure functions) ─────────────────────
export {
  computeCheckoutTotals,
  computeParentServiceFee,
} from "./checkout/pricing";
export type {
  CheckoutDiscounts,
  CheckoutTotals,
  VendorCheckoutGroup,
} from "./checkout/pricing";
