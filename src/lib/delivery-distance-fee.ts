/**
 * Distance-based delivery fee (universal — replaces the legacy zone system).
 *
 * Operator pricing decision (2026-09-26): drop the admin-managed
 * `delivery_zones` table entirely. The fee is now computed from the
 * straight-line distance between the main store
 * (`stores.is_main = true`) and the customer's address:
 *
 *   distance_km ≤  0       → 0      (defensive: no address)
 *   distance_km ≤  included_km → base_sar (flat base)
 *   distance_km  >  included_km → base_sar + per_extra_km_sar × (distance_km − included_km)  SAR
 *
 * Three of those knobs — `baseSar`, `includedKm`, `perExtraKmSar` — are
 * runtime-tunable from `/admin/delivery-settings` (persisted under the
 * `delivery_settings.pricing` JSONB column). When the caller omits them
 * we fall back to the constants exported below (3 SAR base, first 5 km
 * included, +1.5 SAR per extra km).
 *
 * Applies to every order — catalog-only, vendor-only, or mixed
 * multi-vendor — and to every vendor group inside the cart (no more
 * `vendor_settings.delivery_fee_override`). The `free_delivery` coupon
 * type still waives this fee; pickup mode zeroes it as before.
 *
 * Rounding: SAR uses 2 decimals (`toFixed(2)`). The `Number(...)` cast
 * strips floating-point drift (e.g. `0.1 + 0.2`) so the caller gets a
 * clean `3.15` instead of `3.1499999999…`.
 */

export const DELIVERY_BASE_SAR = 3;
export const DELIVERY_INCLUDED_KM = 5;
export const DELIVERY_PER_EXTRA_KM_SAR = 1.5;

/**
 * Admin-tunable knobs for the distance-based fee. All optional — when
 * absent or non-finite, `computeDistanceFee` falls back to the
 * `DELIVERY_*` constants. Stored under `delivery_settings.pricing` in
 * the DB.
 */
export interface DeliveryDistanceFeeSettings {
  baseSar?: number | null;
  includedKm?: number | null;
  perExtraKmSar?: number | null;
}

/**
 * Compute the delivery fee for a given straight-line distance in km.
 *
 *   - `distanceKm <= 0` → 0 (defensive: no routable address should
 *     not bill the customer).
 *   - `distanceKm` non-finite (Infinity / NaN) → 0 (caller didn't
 *     supply a real distance; fail-safe).
 *   - `distanceKm` within the included window → flat base fee.
 *   - `distanceKm` beyond → base + per-km × extra km.
 *
 * `settings` overrides the baked-in defaults (3 / 2 / 1.5) so the admin
 * can tune the formula from the dashboard without redeploying. Bad
 * values (negative, NaN) silently fall back to the default constant.
 */
export function computeDistanceFee(
  distanceKm: number | null | undefined,
  settings?: DeliveryDistanceFeeSettings,
): number {
  if (distanceKm == null || !Number.isFinite(distanceKm) || distanceKm <= 0) {
    return 0;
  }

  const baseSar = pickFinitePositive(settings?.baseSar, DELIVERY_BASE_SAR);
  const includedKm = pickFinitePositive(
    settings?.includedKm,
    DELIVERY_INCLUDED_KM,
  );
  const perExtraKmSar = pickFinitePositive(
    settings?.perExtraKmSar,
    DELIVERY_PER_EXTRA_KM_SAR,
  );

  if (distanceKm <= includedKm) {
    return Number(baseSar.toFixed(2));
  }
  const fee = baseSar + perExtraKmSar * (distanceKm - includedKm);
  return Number(fee.toFixed(2));
}

function pickFinitePositive(
  candidate: number | null | undefined,
  fallback: number,
): number {
  if (candidate == null || !Number.isFinite(candidate) || candidate < 0) {
    return fallback;
  }
  return candidate;
}
