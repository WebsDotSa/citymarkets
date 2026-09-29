/**
 * Public barrel for the Delivery bounded context.
 *
 * Phase 10.5 (domain-modules refactor): extracted from `src/lib/` root to
 * give distance / hours / slots / driver dispatch / geo a clear home.
 *
 * Internal organization:
 *   - delivery-address.ts      — browser-side localStorage address model
 *   - delivery-distance-fee.ts — distance-based delivery fee formula
 *   - delivery-hours.ts        — vendor delivery hours + open/closed check
 *   - delivery-slots.ts        — time-slot configuration + availability
 *   - geo.ts                   — haversine distance
 *   - geocode.ts               — reverse geocode lat/lng → address
 *   - vendor-store-hours.ts    — parse + evaluate vendor hours
 *   - vendor-closed-gate.ts    — block checkout when vendors are closed
 */

// ── Delivery address (browser localStorage model) ───────────────────────
export {
  ADDRESSES_STORAGE,
  ADDRESS_LABELS,
  DEFAULT_MAP_CENTER,
  getOrCreateGuestKey,
  getSelectedAddressId,
  GUEST_KEY_STORAGE,
  isPersistedAddressId,
  loadLocalAddresses,
  saveLocalAddresses,
  SELECTED_ADDRESS_STORAGE,
  setSelectedAddressId,
  shortAddressLabel,
} from "./delivery-address";
export type { AddressLabelType, DeliveryAddress } from "./delivery-address";

// ── Distance fee ────────────────────────────────────────────────────────
export {
  computeDistanceFee,
  DELIVERY_BASE_SAR,
  DELIVERY_INCLUDED_KM,
  DELIVERY_PER_EXTRA_KM_SAR,
} from "./delivery-distance-fee";
export type { DeliveryDistanceFeeSettings } from "./delivery-distance-fee";

// ── Delivery slots ──────────────────────────────────────────────────────
export {
  addDays,
  buildAvailability,
  DEFAULT_SLOTS_CONFIG,
  findWindow,
  parseSlotsConfig,
  riyadhWallClockToUtc,
  RIYADH_TZ as DELIVERY_SLOTS_RIYADH_TZ,
  toRiyadhDateKey,
  validateSlotSelection,
  windowForTime,
} from "./delivery-slots";
export type { SlotAvailability, SlotWindow, SlotsConfig } from "./delivery-slots";

// ── Geo / geocode ───────────────────────────────────────────────────────
export { haversineKm } from "./geo";
export { reverseGeocode } from "./geocode";

// ── Vendor store hours ──────────────────────────────────────────────────
export {
  buildVendorOpenStatus,
  isVendorOpen,
  parseVendorHours,
  RIYADH_TZ as VENDOR_STORE_HOURS_RIYADH_TZ,
} from "./vendor-store-hours";
export type { VendorHours, VendorOpenStatus } from "./vendor-store-hours";

// Server-only (uses @/lib/db / pg). Deep import only from
// `@/lib/delivery/delivery-hours` and `@/lib/delivery/vendor-closed-gate`.
// Kept out of the public barrel so client bundles don't pull in pg.
// export { getDeliveryHours, evaluateHours, parseDeliveryHours, buildHoursStatus, DEFAULT_DELIVERY_HOURS } from "./delivery-hours";
// export { checkClosedVendorsInCart } from "./vendor-closed-gate";
