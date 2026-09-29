import { describe, it, expect } from "vitest";
import {
  isVendorOpen,
  parseVendorHours,
  buildVendorOpenStatus,
  type VendorHours,
} from "./vendor-store-hours";

/**
 * Build a `Date` whose Riyadh wall-clock matches the given HH:MM.
 * Riyadh is fixed at +03:00 so we just subtract 3 hours from UTC to
 * get the desired Riyadh HH:MM.
 */
function riyadhAt(hhmm: string, dayOffsetDays = 0): Date {
  const [h, m] = hhmm.split(":").map(Number);
  // Pick a fixed UTC reference (2026-06-15 00:00 UTC) to keep tests
  // hermetic, then add hours so Riyadh HH:MM = `hhmm`.
  const base = new Date("2026-06-15T00:00:00.000Z");
  const utcMs =
    base.getTime() +
    dayOffsetDays * 24 * 60 * 60_000 +
    h * 60 * 60_000 +
    m * 60_000 -
    3 * 60 * 60_000; // Riyadh HH:MM = UTC + 3h → UTC = Riyadh - 3h
  return new Date(utcMs);
}

const baseVendor: VendorHours = {
  id: "v1",
  open_time: "09:00",
  close_time: "23:00",
  is_active: true,
  name: "Test Vendor",
  slug: "test-vendor",
};

describe("parseVendorHours", () => {
  it("returns null for null/undefined input", () => {
    expect(parseVendorHours(null)).toBeNull();
    expect(parseVendorHours(undefined)).toBeNull();
  });

  it("falls back to platform defaults (09:00-23:00) for malformed times", () => {
    const parsed = parseVendorHours({
      id: "v1",
      open_time: "99:99",
      close_time: "not-a-time",
      is_active: true,
    });
    expect(parsed?.open_time).toBe("09:00");
    expect(parsed?.close_time).toBe("23:00");
  });

  it("preserves valid times verbatim", () => {
    const parsed = parseVendorHours({
      id: "v1",
      open_time: "22:00",
      close_time: "02:00",
      is_active: false,
      name: "ACME",
    });
    expect(parsed?.open_time).toBe("22:00");
    expect(parsed?.close_time).toBe("02:00");
    expect(parsed?.is_active).toBe(false);
    expect(parsed?.name).toBe("ACME");
  });
});

describe("isVendorOpen — normal window 09:00-23:00", () => {
  it("is open at 09:00 boundary", () => {
    expect(isVendorOpen(baseVendor, riyadhAt("09:00"))).toBe(true);
  });
  it("is open at noon", () => {
    expect(isVendorOpen(baseVendor, riyadhAt("12:00"))).toBe(true);
  });
  it("is closed one minute before opening (08:59)", () => {
    expect(isVendorOpen(baseVendor, riyadhAt("08:59"))).toBe(false);
  });
  it("is closed at closing time exactly (23:00)", () => {
    expect(isVendorOpen(baseVendor, riyadhAt("23:00"))).toBe(false);
  });
  it("is closed after midnight (00:30)", () => {
    expect(isVendorOpen(baseVendor, riyadhAt("00:30"))).toBe(false);
  });
});

describe("isVendorOpen — overnight shift 22:00-02:00", () => {
  const overnight: VendorHours = { ...baseVendor, open_time: "22:00", close_time: "02:00" };
  it("is open at 23:30", () => {
    expect(isVendorOpen(overnight, riyadhAt("23:30"))).toBe(true);
  });
  it("is open at 01:00 (after midnight)", () => {
    expect(isVendorOpen(overnight, riyadhAt("01:00"))).toBe(true);
  });
  it("is closed at 03:00 (after closing)", () => {
    expect(isVendorOpen(overnight, riyadhAt("03:00"))).toBe(false);
  });
  it("is closed at 21:00 (before opening)", () => {
    expect(isVendorOpen(overnight, riyadhAt("21:00"))).toBe(false);
  });
});

describe("isVendorOpen — guards", () => {
  it("returns false when vendor is null", () => {
    expect(isVendorOpen(null)).toBe(false);
  });
  it("returns false when is_active=false even inside the window", () => {
    const closed: VendorHours = { ...baseVendor, is_active: false };
    expect(isVendorOpen(closed, riyadhAt("12:00"))).toBe(false);
  });
  it("returns false when open_time === close_time (never-open signal)", () => {
    const never: VendorHours = { ...baseVendor, open_time: "09:00", close_time: "09:00" };
    expect(isVendorOpen(never, riyadhAt("09:30"))).toBe(false);
  });
});

describe("buildVendorOpenStatus", () => {
  it("returns 'closed by admin' message when is_active=false", () => {
    const closed: VendorHours = { ...baseVendor, is_active: false };
    const status = buildVendorOpenStatus(closed, riyadhAt("12:00"));
    expect(status.open).toBe(false);
    expect(status.message).toContain("إدارة المنصة");
  });
  it("returns 'never configured' when open===close", () => {
    const never: VendorHours = { ...baseVendor, open_time: "09:00", close_time: "09:00" };
    const status = buildVendorOpenStatus(never, riyadhAt("12:00"));
    expect(status.open).toBe(false);
    expect(status.message).toContain("لم يحدد");
  });
  it("returns 'مفتوح' message when inside window", () => {
    const status = buildVendorOpenStatus(baseVendor, riyadhAt("12:00"));
    expect(status.open).toBe(true);
    expect(status.message).toContain("مفتوح");
  });
  it("returns generic 'unavailable' message when vendor is null", () => {
    const status = buildVendorOpenStatus(null, riyadhAt("12:00"));
    expect(status.open).toBe(false);
    expect(status.message).toContain("غير متاح");
  });
});
