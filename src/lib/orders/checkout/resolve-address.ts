// Address resolution for the unified checkout.
//
// Extracted from the old `resolve-delivery.ts` after we dropped the
// `delivery_zones` system (migration 060). Now the only thing the
// checkout needs from the user's saved addresses is the lat/lng —
// the delivery fee is computed by `haversineKm` against the main
// store, not by looking up a polygon.
//
// Pure functions — all side effects (DB queries for the address row)
// live in the routes, but the *logic* lives here so it can be
// unit-tested.

export interface DeliveryAddressRow {
  id: string;
  lat: number | string | null;
  lng: number | string | null;
}

/**
 * Resolve the user's address row to use for the order. Picks the
 * explicit `addressId` if provided, otherwise the default address.
 * Returns the row so the route can extract lat/lng next.
 */
export function pickUserAddress(
  addresses: DeliveryAddressRow[],
  addressId: string | undefined,
): DeliveryAddressRow | null {
  if (addressId) {
    const a = addresses.find((x) => x.id === addressId);
    return a ?? null;
  }
  // First address is the default (caller orders by is_default DESC).
  return addresses[0] ?? null;
}