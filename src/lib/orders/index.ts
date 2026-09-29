/**
 * Public barrel for the Orders bounded context.
 *
 * Phase 10.4 (domain-modules refactor): extracted from `src/lib/` root
 * to give checkout, order lifecycle, payment actions, loyalty, abandoned
 * carts, and pricing a clear home.
 *
 * Internal organization:
 *   - order-status.ts           — canonical status enums + Arabic labels
 *   - order-ownership.ts        — assert caller owns the order
 *   - order-paid-confirm.ts     — build + send "order paid" SMS
 *   - order-notify-admin.ts     — notify admin of new orders
 *   - order-metrics.ts          — revenue SQL/constants
 *   - order-payment-action.ts   — determine retry-ability of failed orders
 *   - loyalty.ts                — loyalty settings + earn/redeem helpers
 *   - abandoned-carts.ts        — snapshot + recover abandoned carts
 *   - pricing.ts                — order fee calculator
 *   - checkout/                 — multi-vendor checkout orchestrator
 *     - checkout-service.ts     — main entry (idempotent, atomic)
 *     - create-checkout.ts      — build checkout from cart + address
 *     - pricing.ts              — per-vendor checkout pricing
 *     - resolve-address.ts      — pick address row for current user
 *     - resolve-items.ts        — resolve cart items against catalog
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

// ── Order ownership ─────────────────────────────────────────────────────
export {
  assertOrderOwnership,
  idempotencyKeyFromBody,
  idempotencyKeyFromQuery,
} from "./order-ownership";
export type { OrderOwnership, OrderOwnershipInput } from "./order-ownership";

// ── Order paid confirmation SMS ─────────────────────────────────────────
export {
  buildOrderPaidConfirmationBody,
  sendOrderPaidConfirmationSms,
} from "./order-paid-confirm";

// ── Notify admin of new orders ──────────────────────────────────────────
export { notifyAdminNewOrder } from "./order-notify-admin";

// ── Order revenue metrics ───────────────────────────────────────────────
export {
  countsAsElectronicRevenue,
  isElectronicPaymentMethod,
  REVENUE_ORDER_STATUS,
  REVENUE_PAYMENT_STATUS,
  SQL_REVENUE_ELIGIBLE,
} from "./order-metrics";

// ── Order payment action (retry-ability) ────────────────────────────────
export {
  getOrderPaymentAction,
  isRetryableOrderPayment,
  ONLINE_RETRYABLE_METHODS,
} from "./order-payment-action";
export type {
  OrderPaymentAction,
  OrderPaymentActionInput,
} from "./order-payment-action";

// ── Loyalty ─────────────────────────────────────────────────────────────
export {
  awardPointsForOrder,
  computeEarnPoints,
  DEFAULT_LOYALTY_SETTINGS,
  getLoyaltySettings,
  resolveRedeemForOrder,
} from "./loyalty";
export type { LoyaltySettings } from "./loyalty";

// ── Abandoned carts ─────────────────────────────────────────────────────
export {
  findAbandonedSnapshotByIntentOrder,
  markAbandonedCartRecovered,
  snapshotAbandonedCartFromOrder,
} from "./abandoned-carts";
export type {
  AbandonedCartActor,
  AbandonedCartItem,
  AbandonedCartRecoveryResult,
  AbandonedCartSnapshotInput,
} from "./abandoned-carts";

// ── Pricing (order fees) ────────────────────────────────────────────────
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

// ── Checkout service (main orchestrator) ────────────────────────────────
export { runCheckout } from "./checkout/checkout-service";
export type {
  CheckoutReplayBody,
  CheckoutServiceCaller,
  CheckoutServiceContext,
  CheckoutServiceResult,
  CheckoutSuccessBody,
} from "./checkout/checkout-service";

// ── Checkout create ─────────────────────────────────────────────────────
export { createCheckout } from "./checkout/create-checkout";
export type {
  CheckoutFailure,
  CheckoutInput,
  CheckoutResult,
  CheckoutSuccess,
  CreateCheckoutArgs,
} from "./checkout/create-checkout";

// ── Checkout pricing (per-vendor) ───────────────────────────────────────
export {
  computeCheckoutTotals,
  computeParentServiceFee,
} from "./checkout/pricing";
export type {
  CheckoutDiscounts,
  CheckoutTotals,
  VendorCheckoutGroup,
} from "./checkout/pricing";

// ── Checkout resolve address ────────────────────────────────────────────
export { pickUserAddress } from "./checkout/resolve-address";
export type { DeliveryAddressRow } from "./checkout/resolve-address";

// ── Checkout resolve items ──────────────────────────────────────────────
export { resolveItems } from "./checkout/resolve-items";
export type {
  CatalogResolveInput,
  ItemResolutionError,
  ResolvedCatalogItem,
  ResolvedCheckout,
  ResolvedVendorGroup,
  ResolvedVendorItem,
  ResolveItemsArgs,
  VendorGroupResolveInput,
} from "./checkout/resolve-items";
