/**
 * Canonical "main store + distance to a customer point" helper.
 *
 * Replaces the three near-identical inline implementations that lived in:
 *   - `src/app/api/v1/orders/route.ts`             (single-vendor POST)
 *   - `src/app/api/v1/delivery/quote/route.ts`     (delivery quote)
 *   - `src/lib/orders/checkout/create-checkout.ts` (multi-vendor checkout)
 *
 * Each inline version drifted slightly:
 *   - The single-vendor route filtered `is_active = true` only
 *   - The delivery-quote route ordered by `is_active DESC NULLS LAST`
 *     (falling back to inactive + warning rather than failing)
 *   - The checkout service took the store as an argument (caller already
 *     preloaded it via a separate SQL query)
 *
 * Centralising the SQL + the haversine call closes the drift window
 * and lets each caller pick the response semantics that fits its route.
 *
 * Why a `Queryable` parameter:
 *   The checkout service runs inside a transaction (PoolClient) so
 *   stock decrements and the store read see the same snapshot. The
 *   other two callers run on the pool directly. Passing `Queryable`
 *   (already used elsewhere in `lib/db/typed`) means a single helper
 *   serves both contexts.
 *
 * Server-only — DO NOT import from a client component. The query uses
 * `pg`-typed parameters and is intended for Next.js route handlers +
 * service modules.
 */
import { haversineKm } from "./geo";
import type { Queryable } from "@/lib/db/typed";

/**
 * One row from the canonical main-store query. Postgres returns numeric
 * columns as strings unless explicitly cast; we accept both shapes so
 * callers don't need to coerce manually.
 */
export interface MainStoreRow {
  lat: string | number | null;
  lng: string | number | null;
  is_active: boolean | null;
}

/**
 * Canonical main-store SELECT. The ORDER BY picks the active row first,
 * then any inactive row as a fallback (matches the delivery-quote route
 * which soft-fails when only inactive stores exist). The WHERE `is_main`
 * ensures the row is the system-wide main store, not a vendor sub-store.
 *
 * LIMIT 1 guarantees we never read two main stores even if a data
 * migration accidentally inserted more than one.
 */
const MAIN_STORE_SQL = `
  SELECT lat, lng, is_active FROM stores
   WHERE is_main = true
   ORDER BY is_active DESC NULLS LAST
   LIMIT 1
`;

export interface MainStoreDistanceResult {
  /**
   * The resolved main-store location, or `null` if no main store is
   * configured / lat-lng missing. Callers can return a 503 / 500 in
   * that case (delivery-quote route does) or silently fall back to
   * `null` distance (orders POST does, see `computeOrderFees`).
   */
  store: MainStoreRow | null;
  /**
   * Straight-line km from the customer point to the main store.
   * `null` when:
   *   - no main store was found
   *   - the main store has no lat/lng
   *   - `pointLat`/`pointLng` was not provided
   *   - either `pointLat` or `pointLng` is null
   * `null` distance is treated as "fee is 0 SAR" by the pricing
   * pipeline (fail-safe — admin needs to configure the store).
   */
  distanceKm: number | null;
}

/**
 * Resolve the main store + compute haversine distance to a customer
 * point (if provided). The query runs inside the caller's transaction
 * if a `PoolClient` is passed.
 *
 * @param db        - the queryable (pool or transaction client)
 * @param pointLat  - customer latitude, or null to skip distance calc
 * @param pointLng  - customer longitude, or null to skip distance calc
 * @returns         - `{ store, distanceKm }`; both fields may be null
 *
 * Example:
 *   const { store, distanceKm } = await getMainStoreAndDistance(
 *     client,
 *     customerLat,
 *     customerLng,
 *   );
 *   if (!store) return error503;
 *   if (distanceKm == null) {
 *     // point not provided (pickup) or store missing coords
 *   }
 */
export async function getMainStoreAndDistance(
  db: Queryable,
  pointLat: number | null | undefined,
  pointLng: number | null | undefined,
): Promise<MainStoreDistanceResult> {
  const result = await db.query<MainStoreRow>(MAIN_STORE_SQL);
  const store = result.rows[0] ?? null;

  // No store configured → caller decides whether to 503 or fall back.
  if (!store) {
    return { store: null, distanceKm: null };
  }

  // Lat/lng missing → can't compute a distance, return null (fail-safe
  // for the pricing pipeline).
  if (
    store.lat == null ||
    store.lng == null ||
    pointLat == null ||
    pointLng == null
  ) {
    return { store, distanceKm: null };
  }

  const distanceKm = haversineKm(
    Number(store.lat),
    Number(store.lng),
    Number(pointLat),
    Number(pointLng),
  );
  return { store, distanceKm };
}
