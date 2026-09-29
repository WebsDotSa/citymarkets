import { describe, it, expect } from 'vitest';
import {
  computeOrderFees,
  computeCouponDiscount,
  computeLoyaltyRedemption,
} from './pricing';

// Migration 060 — `PricingSettings` no longer carries zone-pricing
// knobs. Only `serviceFee*` + `tax*` remain (delivery fee is now
// distance-based and computed via `computeDistanceFee(distanceKm)`).
const basePricing = {
  serviceFeeEnabled: true,
  serviceFeeType: 'fixed' as const,
  serviceFeeValue: 3,
  taxEnabled: false,
  taxPercent: 0,
};

describe('computeOrderFees', () => {
  it('charges the distance-based delivery fee for delivery mode', () => {
    // 10 km → 3 + 1.5 × 5 = 10.5 SAR (first 5 km included in base)
    const fees = computeOrderFees({
      subtotal: 100,
      discount: 0,
      deliveryMode: 'delivery',
      couponFreeDelivery: false,
      distanceKm: 10,
      pricing: { ...basePricing },
    });
    expect(fees.deliveryFee).toBe(Number((3 + 1.5 * 5).toFixed(2)));
    expect(fees.total).toBe(100 + Number((3 + 1.5 * 5).toFixed(2)) + 3); // subtotal + delivery + service
  });

  it('charges the flat 3 SAR base fee within 5 km', () => {
    const fees = computeOrderFees({
      subtotal: 200,
      discount: 0,
      deliveryMode: 'delivery',
      couponFreeDelivery: false,
      distanceKm: 1,
      pricing: { ...basePricing },
    });
    expect(fees.deliveryFee).toBe(3);
  });

  it('adds 1.5 SAR per km beyond the 5 km threshold', () => {
    // 6 km → 3 + 1.5 × 1 = 4.5
    const fees = computeOrderFees({
      subtotal: 100,
      discount: 0,
      deliveryMode: 'delivery',
      couponFreeDelivery: false,
      distanceKm: 6,
      pricing: { ...basePricing },
    });
    expect(fees.deliveryFee).toBe(4.5);
  });

  it('always charges 0 for pickup regardless of distance', () => {
    const fees = computeOrderFees({
      subtotal: 10,
      discount: 0,
      deliveryMode: 'pickup',
      couponFreeDelivery: false,
      distanceKm: 999,
      pricing: { ...basePricing },
    });
    expect(fees.deliveryFee).toBe(0);
  });

  it('waives delivery for coupon of type free_delivery', () => {
    const fees = computeOrderFees({
      subtotal: 50,
      discount: 0,
      deliveryMode: 'delivery',
      couponFreeDelivery: true,
      distanceKm: 25, // would otherwise be a large fee
      pricing: { ...basePricing },
    });
    expect(fees.deliveryFee).toBe(0);
  });

  it('returns 0 delivery when distance is null (no address)', () => {
    const fees = computeOrderFees({
      subtotal: 50,
      discount: 0,
      deliveryMode: 'delivery',
      couponFreeDelivery: false,
      distanceKm: null,
      pricing: { ...basePricing },
    });
    expect(fees.deliveryFee).toBe(0);
  });

  it('computes percent-based service fee', () => {
    const fees = computeOrderFees({
      subtotal: 200,
      discount: 0,
      deliveryMode: 'pickup',
      couponFreeDelivery: false,
      distanceKm: 4,
      pricing: {
        ...basePricing,
        serviceFeeType: 'percent',
        serviceFeeValue: 5,
      },
    });
    expect(fees.serviceFee).toBe(10); // 5% of 200
  });

  it('skips service fee when disabled in pricing', () => {
    const fees = computeOrderFees({
      subtotal: 100,
      discount: 0,
      deliveryMode: 'pickup',
      couponFreeDelivery: false,
      distanceKm: 4,
      pricing: { ...basePricing, serviceFeeEnabled: false },
    });
    expect(fees.serviceFee).toBe(0);
  });

  it('adds tax when taxEnabled', () => {
    const fees = computeOrderFees({
      subtotal: 200,
      discount: 0,
      deliveryMode: 'pickup',
      couponFreeDelivery: false,
      distanceKm: 4,
      pricing: { ...basePricing, taxEnabled: true, taxPercent: 15 },
    });
    expect(fees.tax).toBe(30);
  });

  it('clamps total at zero when discount exceeds subtotal + fees', () => {
    const fees = computeOrderFees({
      subtotal: 5,
      discount: 100,
      deliveryMode: 'pickup',
      couponFreeDelivery: false,
      distanceKm: 4,
      pricing: { ...basePricing, serviceFeeEnabled: false },
    });
    expect(fees.total).toBe(0);
  });
});

describe('computeCouponDiscount', () => {
  it('returns percentage discount', () => {
    expect(
      computeCouponDiscount({
        coupon: { type: 'percentage', value: 10, is_active: true },
        subtotal: 100,
      })
    ).toEqual({ discount: 10, freeDelivery: false });
  });

  it('caps percentage discount at max_discount', () => {
    expect(
      computeCouponDiscount({
        coupon: {
          type: 'percentage',
          value: 50,
          max_discount: 20,
          is_active: true,
        },
        subtotal: 200,
      })
    ).toEqual({ discount: 20, freeDelivery: false });
  });

  it('caps fixed discount at the subtotal', () => {
    expect(
      computeCouponDiscount({
        coupon: { type: 'fixed', value: 50, is_active: true },
        subtotal: 20,
      })
    ).toEqual({ discount: 20, freeDelivery: false });
  });

  it('returns freeDelivery flag without a subtotal discount', () => {
    expect(
      computeCouponDiscount({
        coupon: { type: 'free_delivery', value: 0, is_active: true },
        subtotal: 50,
      })
    ).toEqual({ discount: 0, freeDelivery: true });
  });

  it('rejects an inactive coupon', () => {
    expect(
      computeCouponDiscount({
        coupon: { type: 'percentage', value: 10, is_active: false },
        subtotal: 100,
      })
    ).toBeNull();
  });

  it('rejects an expired coupon', () => {
    expect(
      computeCouponDiscount({
        coupon: {
          type: 'percentage',
          value: 10,
          is_active: true,
          expires_at: '2020-01-01',
        },
        subtotal: 100,
      })
    ).toBeNull();
  });

  it('rejects a coupon whose max_uses is exhausted', () => {
    expect(
      computeCouponDiscount({
        coupon: {
          type: 'percentage',
          value: 10,
          is_active: true,
          max_uses: 5,
          used_count: 5,
        },
        subtotal: 100,
      })
    ).toBeNull();
  });

  it('rejects when subtotal is below min_order', () => {
    expect(
      computeCouponDiscount({
        coupon: {
          type: 'percentage',
          value: 10,
          min_order: 200,
          is_active: true,
        },
        subtotal: 100,
      })
    ).toBeNull();
  });
});

describe('computeLoyaltyRedemption', () => {
  it('returns zeros when the user redeemed nothing', () => {
    expect(
      computeLoyaltyRedemption({
        balance: 1000,
        subtotalAfterCoupon: 100,
        requestedPoints: 0,
      })
    ).toEqual({ pointsRedeemed: 0, pointsDiscount: 0 });
  });

  it('caps redemption at the user balance', () => {
    const out = computeLoyaltyRedemption({
      balance: 50, // less than 100 (smallest bundle)
      subtotalAfterCoupon: 1000,
      requestedPoints: 500,
    });
    // balance 50 < 100 → snap to 0
    expect(out.pointsRedeemed).toBe(0);
    expect(out.pointsDiscount).toBe(0);
  });

  it('snaps to 100-point bundles', () => {
    const out = computeLoyaltyRedemption({
      balance: 1000,
      subtotalAfterCoupon: 1000,
      requestedPoints: 250, // → 200
    });
    expect(out.pointsRedeemed).toBe(200);
    // 200/100 * 5 = 10 SAR
    expect(out.pointsDiscount).toBe(10);
  });

  it('caps discount at 50% of subtotal after coupon', () => {
    const out = computeLoyaltyRedemption({
      balance: 100_000,
      subtotalAfterCoupon: 10, // tiny subtotal
      requestedPoints: 5000,
    });
    // 5000/100*5 = 250 SAR, but 50% of 10 = 5 SAR → cap wins
    expect(out.pointsDiscount).toBeLessThanOrEqual(5);
  });
});
