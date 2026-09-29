/**
 * Order pricing utilities.
 *
 * Pure functions — no I/O. They take already-fetched DB rows and return
 * the numbers that should end up in `orders.subtotal`, `delivery_fee`,
 * `service_fee`, `discount`, `total`, etc.
 *
 * Extracted from `app/api/v1/orders/route.ts` so they can be unit-tested
 * and reused by `app/api/v1/delivery/quote/route.ts`.
 *
 * Migration 060: delivery fee is no longer zone-based. The single source
 * of truth is `computeDistanceFee(distanceKm, settings)` from
 * `@/lib/delivery-distance-fee` — defaults: 3 SAR base, first 2 km
 * included, then +1.5 SAR/km. The `settings` object (sourced from
 * `delivery_settings.pricing` in the DB) lets the admin tune
 * `baseSar` / `includedKm` / `perExtraKmSar` from the dashboard.
 * Distance is measured from the main store
 * (`stores.is_main = true`) to the customer's lat/lng.
 */
import {
  computeDistanceFee,
  type DeliveryDistanceFeeSettings,
} from '@/lib/delivery-distance-fee';

export interface PricingSettings extends DeliveryDistanceFeeSettings {
  serviceFeeEnabled?: boolean;
  serviceFeeType?: 'fixed' | 'percent' | string;
  serviceFeeValue?: number | string | null;
  taxEnabled?: boolean;
  taxPercent?: number | string | null;
}

export interface FeeBreakdown {
  deliveryFee: number;
  serviceFee: number;
  tax: number;
  total: number;
}

/**
 * Compute delivery/service/tax fees and the order total.
 *
 * Rules:
 *   - Pickup → free delivery
 *   - Coupon `free_delivery` → free delivery
 *   - Otherwise delivery fee is `computeDistanceFee(distanceKm)`
 *     (3 SAR within 5 km, +1.5 SAR/km beyond — see
 *     `@/lib/delivery-distance-fee`).
 *   - Service fee is `percent` of subtotal or fixed
 *   - Tax is `percent` of subtotal
 */
export function computeOrderFees(args: {
  subtotal: number;
  discount: number;
  deliveryMode: 'delivery' | 'pickup';
  couponFreeDelivery: boolean;
  /**
   * Straight-line km from the main store to the customer's address.
   * `null` / `Infinity` / `NaN` → delivery is 0 SAR (fail-safe).
   */
  distanceKm: number | null;
  pricing: PricingSettings;
}): FeeBreakdown {
  const { subtotal, discount, deliveryMode, couponFreeDelivery, distanceKm, pricing } = args;

  const deliveryFee =
    deliveryMode === 'pickup' || couponFreeDelivery
      ? 0
      : computeDistanceFee(distanceKm, {
          baseSar: numberOrNull(pricing.baseSar),
          includedKm: numberOrNull(pricing.includedKm),
          perExtraKmSar: numberOrNull(pricing.perExtraKmSar),
        });

  const serviceFeeEnabled = pricing.serviceFeeEnabled !== false;
  const serviceFeeType =
    (pricing.serviceFeeType as string) === 'percent' ? 'percent' : 'fixed';
  const serviceFeeValue = Number(pricing.serviceFeeValue ?? 3);
  const serviceFee = !serviceFeeEnabled
    ? 0
    : serviceFeeType === 'percent'
      ? Math.round((subtotal * serviceFeeValue) / 100 * 100) / 100
      : serviceFeeValue;

  const taxEnabled = pricing.taxEnabled === true;
  const taxPercent = Number(pricing.taxPercent ?? 0);
  const tax = taxEnabled ? Math.round((subtotal * taxPercent) / 100 * 100) / 100 : 0;

  const total = Math.max(0, subtotal - discount + deliveryFee + serviceFee + tax);

  return { deliveryFee, serviceFee, tax, total };
}

export interface CouponRow {
  id?: string;
  code?: string;
  type: string;
  value: number | string;
  min_order?: number | string | null;
  max_discount?: number | string | null;
  max_uses?: number | string | null;
  used_count?: number | string | null;
  expires_at?: string | Date | null;
  is_active: boolean;
}

/**
 * Validate and compute a coupon's discount against the order subtotal.
 * Returns `null` when the coupon is not applicable (expired, exhausted,
 * below `min_order`, inactive). When valid returns the discount amount
 * AND a flag indicating whether the coupon waives the delivery fee.
 */
export function computeCouponDiscount(args: {
  coupon: CouponRow;
  subtotal: number;
}): { discount: number; freeDelivery: boolean } | null {
  const { coupon, subtotal } = args;

  if (
    !coupon ||
    !coupon.is_active ||
    (coupon.expires_at && new Date(coupon.expires_at) < new Date()) ||
    (coupon.max_uses != null && Number(coupon.used_count) >= Number(coupon.max_uses))
  ) {
    return null;
  }

  if (Number(coupon.min_order ?? 0) > 0 && subtotal < Number(coupon.min_order)) {
    return null;
  }

  const couponValue = Number(coupon.value);
  const maxDiscount = coupon.max_discount != null ? Number(coupon.max_discount) : null;

  if (coupon.type === 'percentage') {
    let d = Math.round((subtotal * couponValue) / 100 * 100) / 100;
    if (maxDiscount != null) d = Math.min(d, maxDiscount);
    return { discount: d, freeDelivery: false };
  }
  if (coupon.type === 'fixed') {
    return { discount: Math.min(subtotal, couponValue), freeDelivery: false };
  }
  if (coupon.type === 'free_delivery') {
    return { discount: 0, freeDelivery: true };
  }
  return null;
}

/**
 * Compute how many loyalty points can be redeemed for this order.
 *
 * Defaults (100 pts = 5 SAR, 50% cap, 100-pt bundles) match the marketing
 * page and the legacy inline implementation byte-for-byte. Pass `settings`
 * (e.g. from `getLoyaltySettings()`) to honour admin-tuned rates.
 *
 * Returns zeros when the user has insufficient balance or when `requestedPoints`
 * is zero.
 */
export interface LoyaltyRedemptionSettings {
  redeem_value_per_point?: number;
  max_redeem_percent?: number;
  bundle_size?: number;
}

export function computeLoyaltyRedemption(args: {
  balance: number;
  subtotalAfterCoupon: number;
  requestedPoints: number;
  settings?: LoyaltyRedemptionSettings;
}): { pointsRedeemed: number; pointsDiscount: number } {
  const { balance, subtotalAfterCoupon, requestedPoints } = args;

  const valuePerPoint = Number(args.settings?.redeem_value_per_point ?? 0.05);
  const maxPercent = Number(args.settings?.max_redeem_percent ?? 0.5);
  const bundleSize = Math.max(1, Math.floor(Number(args.settings?.bundle_size ?? 100)));

  if (requestedPoints <= 0) {
    return { pointsRedeemed: 0, pointsDiscount: 0 };
  }

  const maxByPoints = balance * valuePerPoint;
  const maxByOrder = subtotalAfterCoupon * maxPercent;
  const cap = Math.min(maxByPoints, maxByOrder);

  // Server is the source of truth — ignore the client-provided discount
  // and recompute from the points the user actually asked to spend.
  let points = Math.min(requestedPoints, balance);
  points = points - (points % bundleSize); // snap to bundle increments
  const recomputed = points * valuePerPoint;
  const discount = Math.min(recomputed, cap);

  return { pointsRedeemed: points, pointsDiscount: discount };
}

/**
 * Coerce a JSON value (number, numeric string, null, undefined) into a
 * finite number, or `null` when the value is missing / not numeric.
 * Used to read the admin-tunable distance knobs out of
 * `delivery_settings.pricing` before passing them into
 * `computeDistanceFee`.
 */
function numberOrNull(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}