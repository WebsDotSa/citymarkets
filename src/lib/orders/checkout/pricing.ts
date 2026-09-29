// Multi-vendor checkout pricing.
//
// Pure functions — no I/O. The caller passes the resolved cart (per-vendor
// subtotals, the catalog subtotal, the delivery distance, the coupon, and
// the loyalty request) and gets back the canonical totals that should
// end up in `orders.*` and `vendor_orders.*`.
//
// Invariants enforced here (defense in depth — the route also validates
// these):
//   - Coupon discount and loyalty redemption apply ONLY to the catalog
//     subtotal. Vendor orders never get a coupon or loyalty discount
//     applied — that's a vendor-policy decision, not a marketplace one.
//   - Pickup mode waives delivery for every group (catalog + vendor).
//   - Delivery fee is computed once on `distanceKm` via
//     `computeDistanceFee` (3 SAR + 1.5 SAR/km after 5 km, distance
//     measured from the main store). The same fee applies to every
//     vendor group in the cart — vendor overrides are gone
//     (migration 060).
//   - Service fee is computed once on the parent subtotal (catalog only).
//   - The grand total is the sum of every group's subtotal + the same
//     delivery fee, plus the service fee, minus the catalog discount.
//
// All functions are side-effect-free — easy to unit test without a DB.

import {
  computeCouponDiscount,
  computeLoyaltyRedemption,
  type CouponRow,
  type PricingSettings,
} from "../pricing";
import { computeDistanceFee } from '@/lib/delivery';

/** One vendor's resolved group. */
export interface VendorCheckoutGroup {
  vendorId: string;
  vendorSlug: string;
  subtotal: number;
  /**
   * Vendor's min-order amount (vendor policy).
   * The vendor's own delivery fee override is intentionally absent —
   * the marketplace charges every group the same distance-based fee.
   */
  minOrderAmount: number;
}

/** Coupon + loyalty knobs supplied by the route after re-validation. */
export interface CheckoutDiscounts {
  coupon: CouponRow | null;
  pointsRequested: number;
  userLoyaltyBalance: number;
  /**
   * Admin-tuned loyalty rates. Optional — when omitted we fall back to
   * the same defaults used by `computeLoyaltyRedemption` directly
   * (0.05 SAR/point, 50% cap, 100-pt bundles), so legacy callers
   * keep working byte-for-byte.
   */
  loyalty?: {
    redeem_value_per_point?: number;
    max_redeem_percent?: number;
  };
}

/** Output of the multi-vendor pricing pipeline. */
export interface CheckoutTotals {
  catalogSubtotal: number;
  vendorSubtotals: Record<string, number>;
  catalogDeliveryFee: number;
  vendorDeliveryFees: Record<string, number>;
  totalDeliveryFee: number;
  serviceFee: number;
  discount: number;
  couponDiscount: number;
  pointsDiscount: number;
  pointsRedeemed: number;
  total: number;
  /** Per-group line totals (subtotal + the shared delivery fee). */
  vendorTotals: Record<string, number>;
  /** Catalog group's line total (subtotal + delivery fee). */
  catalogTotal: number;
  /** Straight-line km from main store to customer (for debugging / display). */
  distanceKm: number | null;
}

/**
 * Compute the parent's service fee (catalog only). Mirrors the
 * `serviceFee` block of `computeOrderFees`:
 *   - disabled → 0
 *   - percent → subtotal × value / 100
 *   - fixed → value
 */
export function computeParentServiceFee(args: {
  catalogSubtotal: number;
  pricing: PricingSettings;
}): number {
  const { catalogSubtotal, pricing } = args;
  const enabled = pricing.serviceFeeEnabled !== false;
  if (!enabled) return 0;
  const type = (pricing.serviceFeeType as string) === "percent" ? "percent" : "fixed";
  const value = Number(pricing.serviceFeeValue ?? 3);
  if (type === "percent") {
    return Math.round((catalogSubtotal * value) / 100 * 100) / 100;
  }
  return value;
}

/**
 * The end-to-end multi-vendor pricing pipeline. Returns all the
 * numbers the route will write to `orders` and `vendor_orders`.
 *
 * IMPORTANT: coupon and loyalty apply ONLY to the catalog subtotal.
 * If the catalog subtotal is zero, the discount is forced to zero even
 * if a coupon was supplied — the route already rejects this case in
 * zod, but defense in depth.
 *
 * The delivery fee is computed ONCE on `distanceKm` and assigned to
 * each line item — no per-vendor overrides, no zone flat fees. Pickup
 * zeroes the fee; the `free_delivery` coupon type also zeroes it.
 */
export function computeCheckoutTotals(args: {
  catalogSubtotal: number;
  vendorGroups: VendorCheckoutGroup[];
  discounts: CheckoutDiscounts;
  deliveryMode: "delivery" | "pickup";
  /**
   * Straight-line km from the main store (`stores.is_main = true`) to
   * the customer's address. `null` / `Infinity` / `NaN` → 0 SAR
   * (fail-safe — see `computeDistanceFee`).
   */
  distanceKm: number | null;
  pricing: PricingSettings;
}): CheckoutTotals {
  const {
    catalogSubtotal,
    vendorGroups,
    discounts,
    deliveryMode,
    distanceKm,
    pricing,
  } = args;

  // ---- Coupon (catalog only) ----
  let couponDiscount = 0;
  let couponFreeDelivery = false;
  if (discounts.coupon && catalogSubtotal > 0) {
    const computed = computeCouponDiscount({
      coupon: discounts.coupon,
      subtotal: catalogSubtotal,
    });
    if (computed) {
      couponDiscount = computed.discount;
      couponFreeDelivery = computed.freeDelivery;
    }
  }

  // ---- Loyalty (catalog only, after coupon) ----
  let pointsRedeemed = 0;
  let pointsDiscount = 0;
  if (catalogSubtotal > 0 && discounts.pointsRequested > 0) {
    const loyalty = computeLoyaltyRedemption({
      balance: discounts.userLoyaltyBalance,
      subtotalAfterCoupon: Math.max(0, catalogSubtotal - couponDiscount),
      requestedPoints: discounts.pointsRequested,
      settings: discounts.loyalty
        ? {
            redeem_value_per_point: discounts.loyalty.redeem_value_per_point,
            max_redeem_percent: discounts.loyalty.max_redeem_percent,
          }
        : undefined,
    });
    pointsRedeemed = loyalty.pointsRedeemed;
    pointsDiscount = loyalty.pointsDiscount;
  }

  const discount = couponDiscount + pointsDiscount;

  // ---- Delivery fee (single, universal) ----
  // Pickup and coupon free-delivery both waive the fee. Otherwise the
  // fee is purely a function of distance.
  let catalogDeliveryFee = 0;
  if (deliveryMode !== "pickup" && !couponFreeDelivery) {
    catalogDeliveryFee = computeDistanceFee(distanceKm);
  }
  // The same fee applies to every group — no per-vendor override.
  const sharedDeliveryFee = catalogDeliveryFee;

  const vendorDeliveryFees: Record<string, number> = {};
  const vendorSubtotals: Record<string, number> = {};
  const vendorTotals: Record<string, number> = {};
  for (const g of vendorGroups) {
    vendorSubtotals[g.vendorId] = Number(g.subtotal.toFixed(2));
    vendorDeliveryFees[g.vendorId] = sharedDeliveryFee;
    vendorTotals[g.vendorId] = Number((g.subtotal + sharedDeliveryFee).toFixed(2));
  }

  const totalDeliveryFee =
    catalogDeliveryFee +
    Object.values(vendorDeliveryFees).reduce((s, v) => s + v, 0);

  // ---- Service fee once on the parent (catalog subtotal) ----
  const serviceFee = computeParentServiceFee({
    catalogSubtotal,
    pricing,
  });

  const catalogTotal = Number(
    (catalogSubtotal + catalogDeliveryFee).toFixed(2),
  );

  // Grand total = sum (catalog group + N vendor groups) + service fee
  // - catalog discount. Vendor groups never get a discount.
  const total = Math.max(
    0,
    catalogTotal +
      Object.values(vendorTotals).reduce((s, v) => s + v, 0) +
      serviceFee -
      discount,
  );

  return {
    catalogSubtotal: Number(catalogSubtotal.toFixed(2)),
    vendorSubtotals,
    catalogDeliveryFee: Number(catalogDeliveryFee.toFixed(2)),
    vendorDeliveryFees,
    totalDeliveryFee: Number(totalDeliveryFee.toFixed(2)),
    serviceFee: Number(serviceFee.toFixed(2)),
    discount: Number(discount.toFixed(2)),
    couponDiscount: Number(couponDiscount.toFixed(2)),
    pointsDiscount: Number(pointsDiscount.toFixed(2)),
    pointsRedeemed,
    total: Number(total.toFixed(2)),
    vendorTotals,
    catalogTotal,
    distanceKm: distanceKm ?? null,
  };
}