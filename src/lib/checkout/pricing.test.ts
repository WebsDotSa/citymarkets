import { describe, it, expect } from 'vitest';
import {
  computeParentServiceFee,
  computeCheckoutTotals,
  type VendorCheckoutGroup,
} from '@/lib/checkout/pricing';
import type { CouponRow, PricingSettings } from '@/lib/pricing';

const basePricing: PricingSettings = {
  serviceFeeEnabled: true,
  serviceFeeType: 'fixed',
  serviceFeeValue: 3,
  taxEnabled: false,
  taxPercent: 0,
};

const vendorGroupsFixture: VendorCheckoutGroup[] = [
  {
    vendorId: '00000000-0000-0000-0000-0000000000aa',
    vendorSlug: 'qahwa-amaze',
    subtotal: 50,
    minOrderAmount: 0,
  },
  {
    vendorId: '00000000-0000-0000-0000-0000000000bb',
    vendorSlug: 'abaya-store',
    subtotal: 80,
    minOrderAmount: 0,
  },
];

describe('computeParentServiceFee', () => {
  it('returns the fixed value when enabled and type is fixed', () => {
    expect(
      computeParentServiceFee({
        catalogSubtotal: 100,
        pricing: { ...basePricing, serviceFeeEnabled: true, serviceFeeType: 'fixed', serviceFeeValue: 5 },
      }),
    ).toBe(5);
  });

  it('computes percent of catalogSubtotal', () => {
    expect(
      computeParentServiceFee({
        catalogSubtotal: 200,
        pricing: { ...basePricing, serviceFeeEnabled: true, serviceFeeType: 'percent', serviceFeeValue: 5 },
      }),
    ).toBe(10);
  });

  it('returns 0 when disabled', () => {
    expect(
      computeParentServiceFee({
        catalogSubtotal: 200,
        pricing: { ...basePricing, serviceFeeEnabled: false, serviceFeeType: 'fixed', serviceFeeValue: 5 },
      }),
    ).toBe(0);
  });
});

describe('computeCheckoutTotals — catalog-only', () => {
  it('computes catalog subtotal + delivery + service minus discount', () => {
    const totals = computeCheckoutTotals({
      catalogSubtotal: 100,
      vendorGroups: [],
      discounts: { coupon: null, pointsRequested: 0, userLoyaltyBalance: 0 },
      deliveryMode: 'delivery',
      distanceKm: 3, // within 5 km → flat 3 SAR
      pricing: basePricing,
    });

    expect(totals.catalogSubtotal).toBe(100);
    expect(totals.catalogDeliveryFee).toBe(3);
    expect(totals.totalDeliveryFee).toBe(3);
    expect(totals.serviceFee).toBe(3);
    expect(totals.discount).toBe(0);
    expect(totals.catalogTotal).toBe(103);
    expect(totals.vendorTotals).toEqual({});
    expect(totals.total).toBe(106);
  });

  it('applies a percentage coupon only to the catalog subtotal', () => {
    const coupon: CouponRow = {
      type: 'percentage',
      value: 10,
      is_active: true,
    };

    const totals = computeCheckoutTotals({
      catalogSubtotal: 200,
      vendorGroups: [],
      discounts: { coupon, pointsRequested: 0, userLoyaltyBalance: 0 },
      deliveryMode: 'delivery',
      distanceKm: 4,
      pricing: basePricing,
    });

    expect(totals.couponDiscount).toBe(20);
    expect(totals.discount).toBe(20);
    // 200 subtotal + 3 delivery + 3 service - 20 coupon
    expect(totals.total).toBe(186);
  });
});

describe('computeCheckoutTotals — vendor-only', () => {
  it('sums per-vendor subtotals and applies the same delivery fee to each', () => {
    const totals = computeCheckoutTotals({
      catalogSubtotal: 0,
      vendorGroups: vendorGroupsFixture,
      discounts: { coupon: null, pointsRequested: 0, userLoyaltyBalance: 0 },
      deliveryMode: 'delivery',
      distanceKm: 8, // 3 + 1.5 × 3 = 7.5 SAR
      pricing: { ...basePricing, serviceFeeEnabled: false },
    });

    expect(totals.catalogSubtotal).toBe(0);
    expect(totals.catalogDeliveryFee).toBe(7.5);
    expect(totals.vendorSubtotals).toEqual({
      '00000000-0000-0000-0000-0000000000aa': 50,
      '00000000-0000-0000-0000-0000000000bb': 80,
    });
    expect(totals.vendorDeliveryFees).toEqual({
      '00000000-0000-0000-0000-0000000000aa': 7.5,
      '00000000-0000-0000-0000-0000000000bb': 7.5,
    });
    expect(totals.totalDeliveryFee).toBe(22.5); // catalog + 2 vendors
    expect(totals.vendorTotals).toEqual({
      '00000000-0000-0000-0000-0000000000aa': 57.5,
      '00000000-0000-0000-0000-0000000000bb': 87.5,
    });
    // 7.5 (catalog line) + 57.5 (vendor A) + 87.5 (vendor B) + 0 service = 152.5
    expect(totals.total).toBe(152.5);
  });

  it('ignores coupons and loyalty when catalogSubtotal is 0 (defense in depth)', () => {
    const coupon: CouponRow = {
      type: 'percentage',
      value: 50,
      is_active: true,
    };

    const totals = computeCheckoutTotals({
      catalogSubtotal: 0,
      vendorGroups: [
        {
          vendorId: '00000000-0000-0000-0000-0000000000cc',
          vendorSlug: 'qahwa-amaze',
          subtotal: 100,
          minOrderAmount: 0,
        },
      ],
      discounts: { coupon, pointsRequested: 999, userLoyaltyBalance: 999 },
      deliveryMode: 'delivery',
      distanceKm: 4, // flat 3 SAR
      pricing: { ...basePricing, serviceFeeEnabled: false },
    });

    expect(totals.couponDiscount).toBe(0);
    expect(totals.pointsDiscount).toBe(0);
    expect(totals.pointsRedeemed).toBe(0);
    // Total = 3 (catalog line) + 100 + 3 (vendor delivery) = 106
    expect(totals.total).toBe(106);
  });
});

describe('computeCheckoutTotals — mixed', () => {
  it('splits catalog discount from vendor totals — vendors never see a discount', () => {
    const coupon: CouponRow = {
      type: 'percentage',
      value: 20,
      is_active: true,
    };

    const totals = computeCheckoutTotals({
      catalogSubtotal: 100,
      vendorGroups: [
        {
          vendorId: '00000000-0000-0000-0000-0000000000dd',
          vendorSlug: 'qahwa-amaze',
          subtotal: 60,
          minOrderAmount: 0,
        },
      ],
      discounts: { coupon, pointsRequested: 0, userLoyaltyBalance: 0 },
      deliveryMode: 'delivery',
      distanceKm: 7, // 3 + 1.5 × 2 = 6 SAR
      pricing: { ...basePricing, serviceFeeEnabled: true, serviceFeeType: 'fixed', serviceFeeValue: 3 },
    });

    expect(totals.catalogSubtotal).toBe(100);
    expect(totals.catalogDeliveryFee).toBe(6);
    expect(totals.catalogTotal).toBe(106);
    expect(totals.vendorTotals).toEqual({
      '00000000-0000-0000-0000-0000000000dd': 66, // 60 subtotal + 6 delivery
    });
    expect(totals.couponDiscount).toBe(20); // 20% of 100
    // Grand total = catalogTotal (106) + vendorTotal (66) + service (3) - coupon (20)
    expect(totals.total).toBe(155);
  });

  it('applies loyalty after coupon, only against catalog subtotal', () => {
    const totals = computeCheckoutTotals({
      catalogSubtotal: 200,
      vendorGroups: vendorGroupsFixture,
      discounts: {
        coupon: null,
        pointsRequested: 100,
        userLoyaltyBalance: 500,
      },
      deliveryMode: 'delivery',
      distanceKm: 4, // flat 3 SAR
      pricing: { ...basePricing, serviceFeeEnabled: false },
    });

    // 100 points redeemed → 5 SAR (100 pts = 5 SAR per pricing rule).
    // 5 is well below the 50%-of-subtotal cap, so the full 5 SAR is granted.
    // vendor groups keep full subtotal + delivery.
    expect(totals.pointsRedeemed).toBe(100);
    expect(totals.pointsDiscount).toBe(5);
    expect(totals.discount).toBe(5);
    expect(totals.vendorTotals).toEqual({
      '00000000-0000-0000-0000-0000000000aa': 53,
      '00000000-0000-0000-0000-0000000000bb': 83,
    });
    // 200 (catalog) + 3 (catalog delivery) + 53 (vendor A) + 83 (vendor B) - 5 (loyalty)
    expect(totals.total).toBe(334);
  });
});

describe('computeCheckoutTotals — pickup mode', () => {
  it('zeroes every delivery fee (catalog + each vendor)', () => {
    const totals = computeCheckoutTotals({
      catalogSubtotal: 100,
      vendorGroups: vendorGroupsFixture,
      discounts: { coupon: null, pointsRequested: 0, userLoyaltyBalance: 0 },
      deliveryMode: 'pickup',
      distanceKm: 4,
      pricing: { ...basePricing, serviceFeeEnabled: false },
    });

    expect(totals.catalogDeliveryFee).toBe(0);
    expect(totals.vendorDeliveryFees).toEqual({
      '00000000-0000-0000-0000-0000000000aa': 0,
      '00000000-0000-0000-0000-0000000000bb': 0,
    });
    expect(totals.totalDeliveryFee).toBe(0);
    expect(totals.total).toBe(50 + 80 + 100); // subtotals only
  });
});

describe('computeCheckoutTotals — determinism (idempotent replay)', () => {
  it('returns identical totals for identical input', () => {
    const args = {
      catalogSubtotal: 120,
      vendorGroups: vendorGroupsFixture,
      discounts: {
        coupon: { type: 'percentage', value: 10, is_active: true } as CouponRow,
        pointsRequested: 50,
        userLoyaltyBalance: 100,
      },
      deliveryMode: 'delivery' as const,
      distanceKm: 8 as number | null,
      pricing: basePricing,
    };

    const a = computeCheckoutTotals(args);
    const b = computeCheckoutTotals(args);

    expect(a).toEqual(b);
  });

  it('rounds every monetary field to 2dp so the SQL inserts are stable', () => {
    const totals = computeCheckoutTotals({
      catalogSubtotal: 33.339,
      vendorGroups: [
        {
          vendorId: '00000000-0000-0000-0000-0000000000ee',
          vendorSlug: 'qahwa-amaze',
          subtotal: 19.991,
          minOrderAmount: 0,
        },
      ],
      discounts: { coupon: null, pointsRequested: 0, userLoyaltyBalance: 0 },
      deliveryMode: 'delivery',
      distanceKm: 7, // 6 SAR
      pricing: basePricing,
    });

    expect(totals.catalogSubtotal).toBe(33.34);
    expect(totals.vendorSubtotals['00000000-0000-0000-0000-0000000000ee']).toBe(19.99);
    expect(totals.vendorDeliveryFees['00000000-0000-0000-0000-0000000000ee']).toBe(6);
    expect(totals.totalDeliveryFee).toBe(12);
    // catalogTotal (33.34 + 6) + vendorTotal (19.99 + 6) + service (3) − discount (0)
    // = 39.34 + 25.99 + 3 = 68.33
    expect(totals.total).toBe(68.33);
  });
});

describe('computeCheckoutTotals — distance-based delivery fee', () => {
  it('returns 0 delivery fee when distance is null/undefined (no address yet)', () => {
    const totals = computeCheckoutTotals({
      catalogSubtotal: 50,
      vendorGroups: [],
      discounts: { coupon: null, pointsRequested: 0, userLoyaltyBalance: 0 },
      deliveryMode: 'delivery',
      distanceKm: null,
      pricing: { ...basePricing, serviceFeeEnabled: false },
    });

    expect(totals.catalogDeliveryFee).toBe(0);
    expect(totals.total).toBe(50);
  });

  it('returns 0 delivery fee when distance is Infinity (defensive)', () => {
    const totals = computeCheckoutTotals({
      catalogSubtotal: 50,
      vendorGroups: [],
      discounts: { coupon: null, pointsRequested: 0, userLoyaltyBalance: 0 },
      deliveryMode: 'delivery',
      distanceKm: Infinity,
      pricing: { ...basePricing, serviceFeeEnabled: false },
    });

    expect(totals.catalogDeliveryFee).toBe(0);
  });

  it('charges 3 SAR for distances within the 5 km included window', () => {
    const totals = computeCheckoutTotals({
      catalogSubtotal: 50,
      vendorGroups: [],
      discounts: { coupon: null, pointsRequested: 0, userLoyaltyBalance: 0 },
      deliveryMode: 'delivery',
      distanceKm: 5,
      pricing: { ...basePricing, serviceFeeEnabled: false },
    });

    expect(totals.catalogDeliveryFee).toBe(3);
  });

  it('applies the per-km formula beyond 5 km', () => {
    const totals = computeCheckoutTotals({
      catalogSubtotal: 100,
      vendorGroups: [],
      discounts: { coupon: null, pointsRequested: 0, userLoyaltyBalance: 0 },
      deliveryMode: 'delivery',
      distanceKm: 12, // 3 + 1.5 × 7 = 13.5
      pricing: { ...basePricing, serviceFeeEnabled: false },
    });

    expect(totals.catalogDeliveryFee).toBe(13.5);
  });

  it('applies the same distance fee to every vendor group (no per-vendor overrides)', () => {
    const totals = computeCheckoutTotals({
      catalogSubtotal: 100,
      vendorGroups: vendorGroupsFixture,
      discounts: { coupon: null, pointsRequested: 0, userLoyaltyBalance: 0 },
      deliveryMode: 'delivery',
      distanceKm: 10, // 3 + 1.5 × 5 = 10.5
      pricing: { ...basePricing, serviceFeeEnabled: false },
    });

    expect(totals.catalogDeliveryFee).toBe(10.5);
    expect(totals.vendorDeliveryFees).toEqual({
      '00000000-0000-0000-0000-0000000000aa': 10.5,
      '00000000-0000-0000-0000-0000000000bb': 10.5,
    });
  });

  it('preserves coupon free-delivery waiver regardless of distance', () => {
    const coupon: CouponRow = {
      type: 'free_delivery',
      value: 0,
      is_active: true,
    };
    const totals = computeCheckoutTotals({
      catalogSubtotal: 50,
      vendorGroups: [],
      discounts: { coupon, pointsRequested: 0, userLoyaltyBalance: 0 },
      deliveryMode: 'delivery',
      distanceKm: 30, // would otherwise be 3 + 1.5 × 25 = 40.5 SAR
      pricing: { ...basePricing, serviceFeeEnabled: false },
    });

    expect(totals.catalogDeliveryFee).toBe(0);
    expect(totals.total).toBe(50);
  });

  it('preserves pickup behaviour (delivery fee is 0) regardless of distance', () => {
    const totals = computeCheckoutTotals({
      catalogSubtotal: 50,
      vendorGroups: [],
      discounts: { coupon: null, pointsRequested: 0, userLoyaltyBalance: 0 },
      deliveryMode: 'pickup',
      distanceKm: 100,
      pricing: { ...basePricing, serviceFeeEnabled: false },
    });

    expect(totals.catalogDeliveryFee).toBe(0);
    expect(totals.total).toBe(50);
  });
});