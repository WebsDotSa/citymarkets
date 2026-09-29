/**
 * Geographic utilities used by the delivery pipeline.
 *
 * These helpers are pure (no I/O) and are safe to call from any layer
 * (API route, server component, background job, tests).
 */

const EARTH_RADIUS_KM = 6371;

/**
 * Great-circle distance between two lat/lng points in kilometres.
 *
 * Used to compute the customer's distance from the main store
 * (`stores.is_main = true`) for distance-based delivery pricing.
 *
 * @see https://en.wikipedia.org/wiki/Haversine_formula
 */
export function haversineKm(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number
): number {
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) *
      Math.cos((bLat * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(x)));
}