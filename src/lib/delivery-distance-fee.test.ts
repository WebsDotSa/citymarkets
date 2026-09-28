import { describe, it, expect } from 'vitest';
import {
  computeDistanceFee,
  DELIVERY_BASE_SAR,
  DELIVERY_INCLUDED_KM,
  DELIVERY_PER_EXTRA_KM_SAR,
} from '@/lib/delivery-distance-fee';

describe('computeDistanceFee — universal distance-based delivery fee', () => {
  it('returns the flat base when distance is within the included window', () => {
    expect(computeDistanceFee(0)).toBe(0); // defensive
    expect(computeDistanceFee(1)).toBe(DELIVERY_BASE_SAR);
    expect(computeDistanceFee(DELIVERY_INCLUDED_KM)).toBe(DELIVERY_BASE_SAR);
  });

  it('applies the per-km formula beyond the included window', () => {
    const distance = 7; // 5 extra km beyond the default 2-km window
    const expected =
      DELIVERY_BASE_SAR +
      DELIVERY_PER_EXTRA_KM_SAR * (distance - DELIVERY_INCLUDED_KM);
    expect(computeDistanceFee(distance)).toBe(Number(expected.toFixed(2)));
  });

  it('rounds to 2 decimals for large distances', () => {
    // 100 km → 3 + 1.5 × 98 = 150
    expect(computeDistanceFee(100)).toBe(150);
    // 950 km (Jeddah from Riyadh) → 3 + 1.5 × 948 = 1425
    expect(computeDistanceFee(950)).toBe(1425);
  });

  it('treats null / undefined / Infinity / NaN / negatives as 0 (fail-safe)', () => {
    expect(computeDistanceFee(null)).toBe(0);
    expect(computeDistanceFee(undefined)).toBe(0);
    expect(computeDistanceFee(Infinity)).toBe(0);
    expect(computeDistanceFee(NaN)).toBe(0);
    expect(computeDistanceFee(-3)).toBe(0);
  });

  it('strips floating-point drift via Number(...)', () => {
    // 2.1 km → 3 + 1.5 × 0.1 = 3.15 (not 3.1499999999999995)
    expect(computeDistanceFee(2.1)).toBe(3.15);
  });
});

describe('computeDistanceFee — admin-tunable settings override', () => {
  it('honours the baseSar override from delivery_settings.pricing', () => {
    // distance is in the (overridden) included window → flat base of 5
    expect(computeDistanceFee(4, { baseSar: 5, includedKm: 10 })).toBe(5);
  });

  it('honours the includedKm override (widens the flat window)', () => {
    // 9 km at default falls inside 2-km window → 3.
    // With includedKm=10 it still falls inside → 3.
    // Move past the window to prove the override applies:
    expect(computeDistanceFee(11, { includedKm: 10 })).toBe(
      // base 3 + 1.5 × 1 = 4.5
      Number((3 + 1.5 * 1).toFixed(2)),
    );
  });

  it('honours the perExtraKmSar override', () => {
    // 4 km with default 2-km window + 2 SAR per extra km
    // → 3 + 2 × 2 = 7
    expect(
      computeDistanceFee(4, { perExtraKmSar: 2 }),
    ).toBe(Number((3 + 2 * 2).toFixed(2)));
  });

  it('falls back to the baked-in defaults when the override is bad', () => {
    // Negative / NaN / missing values → constant defaults still apply.
    expect(computeDistanceFee(4, { baseSar: -1 })).toBe(
      // defaults: 3 + 1.5 × 2 = 6
      Number((3 + 1.5 * 2).toFixed(2)),
    );
    expect(computeDistanceFee(4, { baseSar: NaN })).toBe(
      Number((3 + 1.5 * 2).toFixed(2)),
    );
    expect(computeDistanceFee(4, { baseSar: null })).toBe(
      Number((3 + 1.5 * 2).toFixed(2)),
    );
    expect(computeDistanceFee(4, { includedKm: undefined })).toBe(
      Number((3 + 1.5 * 2).toFixed(2)),
    );
  });

  it('lets the admin widen the included window to 0 (pure per-km)', () => {
    // baseSar=0 + includedKm=0 → charge per km from the first km.
    // 10 km × 2 = 20
    expect(
      computeDistanceFee(10, { baseSar: 0, includedKm: 0, perExtraKmSar: 2 }),
    ).toBe(20);
  });
});
