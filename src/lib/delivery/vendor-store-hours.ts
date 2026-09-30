/**
 * Per-vendor open/close hours.
 *
 * Sits next to `delivery-hours.ts` (platform-wide store hours) but is
 * scoped to a single `vendors` row: each vendor can have their own
 * `open_time` / `close_time`, mirroring the multi-vendor marketplace
 * model from migration 010.
 *
 * Pure helpers — no I/O. The vendor settings route reads/writes
 * `vendors.open_time` / `vendors.close_time`, while the checkout
 * closed-vendor gate (`src/lib/vendor-closed-gate.ts`) and the vendor
 * admin layout banner consume the helpers below.
 *
 * Wall-clock interpretation follows `delivery-hours.ts` so a vendor
 * who opens "22:00 → 02:00" treats 01:00 as open and 03:00 as
 * closed (overnight shift).
 *
 * NOTE on `is_active`: `vendors.is_active` exists as an admin
 * kill-switch (migration 010). When `false`, the vendor is treated as
 * closed regardless of the time window — same semantic as the legacy
 * `vendor_inactive` error returned by `resolveItems`.
 */

import { RIYADH_OFFSET_MIN, RIYADH_TZ, hhmmToMinutes, toRiyadhHhmm } from "./riyadh-time";

export { RIYADH_TZ };

export type VendorHours = {
  /** `vendors.id` — included so logging can identify the row. */
  id: string;
  open_time: string; // "HH:MM" 24h Riyadh wall-clock
  close_time: string; // "HH:MM" 24h Riyadh wall-clock
  /** Admin kill-switch — `false` means hard-closed. */
  is_active: boolean;
  /** Localized vendor name for error messages / banners. */
  name?: string | null;
  /** Vendor slug for error messages / banners. */
  slug?: string | null;
};

/**
 * Narrow an unknown DB row (or `null`) into a `VendorHours`. Defends
 * against PG returning strings for time columns — we coerce via the
 * `/^([01]\d|2[0-3]):[0-5]\d$/` regex and fall back to platform
 * defaults (09:00–23:00, matching `delivery-hours.ts`). A `null` row
 * (the vendor wasn't found) maps to a hard-closed result so callers
 * never silently treat a missing vendor as "always open".
 */
export function parseVendorHours(raw: unknown): VendorHours | null {
  if (!raw || typeof raw !== "object") return null;
  const v = raw as Partial<VendorHours>;
  const isValid = (s: unknown): s is string =>
    typeof s === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
  return {
    id: typeof v.id === "string" ? v.id : "",
    open_time: isValid(v.open_time) ? v.open_time : "09:00",
    close_time: isValid(v.close_time) ? v.close_time : "23:00",
    is_active: v.is_active !== false, // default true when col is missing
    name: typeof v.name === "string" ? v.name : v.name ?? null,
    slug: typeof v.slug === "string" ? v.slug : v.slug ?? null,
  };
}

/**
 * "HH:MM" Riyadh wall-clock for a given Date. Mirrors the helper in
 * `delivery-hours.ts` so the two helpers share timezone semantics.
 */

/**
 * Decide whether `now` falls inside the vendor's working window.
 *
 * Rules:
 *   - `vendor == null` → closed (defensive; should never happen because
 *     the gate only includes vendors it successfully loaded).
 *   - `vendor.is_active === false` → closed (admin kill-switch wins
 *     over hours — same semantic as `resolveItems` "vendor_inactive").
 *   - `open_time === close_time` → closed all day. We treat this as a
 *     "not configured" signal so a vendor that hasn't saved their hours
 *     cannot accidentally accept orders.
 *   - Otherwise supports overnight ranges: when `close < open` the
 *     window wraps past midnight (e.g. 22:00 → 02:00).
 */
export function isVendorOpen(
  vendor: VendorHours | null,
  now: Date = new Date(),
): boolean {
  if (!vendor) return false;
  if (vendor.is_active === false) return false;
  if (vendor.open_time === vendor.close_time) return false;

  const nowMin = hhmmToMinutes(toRiyadhHhmm(now));
  const openMin = hhmmToMinutes(vendor.open_time);
  const closeMin = hhmmToMinutes(vendor.close_time);

  if (closeMin < openMin) {
    // Overnight, e.g. 22:00 → 02:00: now ∈ [open, 1440) ∪ [0, close).
    return nowMin >= openMin || nowMin < closeMin;
  }
  return nowMin >= openMin && nowMin < closeMin;
}

/**
 * Convenience for the vendor admin banner + the checkout error JSON:
 * returns the same boolean as `isVendorOpen` plus the time window so
 * the client can render "المتجر مغلق — يفتح غداً الساعة 09:00".
 */
export type VendorOpenStatus = {
  open: boolean;
  openTime: string;
  closeTime: string;
  /** Localized copy for the customer-facing banner. */
  message: string;
};

export function buildVendorOpenStatus(
  vendor: VendorHours | null,
  now: Date = new Date(),
): VendorOpenStatus {
  if (!vendor) {
    return {
      open: false,
      openTime: "",
      closeTime: "",
      message: "المتجر غير متاح حالياً",
    };
  }
  if (vendor.is_active === false) {
    return {
      open: false,
      openTime: vendor.open_time,
      closeTime: vendor.close_time,
      message: "المتجر مغلق بإدارة المنصة",
    };
  }
  if (vendor.open_time === vendor.close_time) {
    return {
      open: false,
      openTime: vendor.open_time,
      closeTime: vendor.close_time,
      message: "المتجر لم يحدد ساعات العمل بعد",
    };
  }
  return {
    open: isVendorOpen(vendor, now),
    openTime: vendor.open_time,
    closeTime: vendor.close_time,
    message: isVendorOpen(vendor, now)
      ? "المتجر مفتوح الآن"
      : `المتجر مغلق — يفتح ${vendor.open_time} ويغلق ${vendor.close_time}`,
  };
}
