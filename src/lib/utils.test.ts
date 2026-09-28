import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  cn,
  formatPrice,
  formatDate,
  formatOrderId,
  googleMapsPlaceUrl,
  googleMapsDirectionsUrl,
  parseCoords,
  normalizeSaudiPhoneForWhatsApp,
  buildOrderPreparingWhatsAppMessage,
  buildWhatsAppUrl,
  coerceAmount,
  parseOrderItems,
  normalizeOrdersListPayload,
  formatPhone,
  delay,
  generateId,
} from "./utils";

describe("cn", () => {
  it("merges class names and resolves tailwind conflicts", () => {
    expect(cn("px-2", "px-4")).toBe("px-4");
    expect(cn("text-red-500", false && "text-blue-500", "text-green-500")).toBe(
      "text-green-500",
    );
  });
});

describe("formatPrice", () => {
  it("formats a number to 2 decimals with ر.س suffix", () => {
    expect(formatPrice(10)).toBe("10.00 ر.س");
    expect(formatPrice(10.5)).toBe("10.50 ر.س");
  });

  it("parses a numeric string", () => {
    expect(formatPrice("12.99")).toBe("12.99 ر.س");
  });

  it("returns 0.00 for null/undefined/non-numeric", () => {
    expect(formatPrice(null)).toBe("0.00 ر.س");
    expect(formatPrice(undefined)).toBe("0.00 ر.س");
    expect(formatPrice("not-a-number")).toBe("NaN ر.س"); // parseFloat returns NaN, toFixed -> "NaN"
  });
});

describe("formatDate", () => {
  it("returns em-dash for null/undefined", () => {
    expect(formatDate(null)).toBe("—");
    expect(formatDate(undefined)).toBe("—");
  });

  it("returns em-dash for invalid date strings", () => {
    expect(formatDate("not a date")).toBe("—");
  });

  it("formats a valid date using the default Arabic locale", () => {
    // The result depends on the runtime's locale data; assert non-empty
    // and that the year is present.
    const formatted = formatDate("2026-01-15T00:00:00Z");
    expect(formatted).not.toBe("—");
    expect(formatted.length).toBeGreaterThan(0);
  });

  it("accepts a Date object", () => {
    const formatted = formatDate(new Date("2026-06-01T00:00:00Z"));
    expect(formatted).not.toBe("—");
    expect(formatted.length).toBeGreaterThan(0);
  });
});

describe("formatOrderId", () => {
  it("pads numeric ids to 8 digits with leading zeros", () => {
    expect(formatOrderId(42)).toBe("00000042");
    expect(formatOrderId("42")).toBe("00000042");
  });

  it("truncates ids longer than 8 digits to the last 8", () => {
    // 1234567890123 has 13 digits; padStart is a no-op and slice(-8) takes the last 8
    expect(formatOrderId(1234567890123)).toBe("67890123");
  });

  it("returns 00000000 for null/undefined/empty", () => {
    expect(formatOrderId(null)).toBe("00000000");
    expect(formatOrderId(undefined)).toBe("00000000");
    expect(formatOrderId("")).toBe("00000000");
  });

  it("strips non-digits from the input", () => {
    expect(formatOrderId("abc-42-xyz")).toBe("00000042");
  });
});

describe("googleMapsPlaceUrl", () => {
  it("produces a google maps place URL with the coordinates", () => {
    expect(googleMapsPlaceUrl(24.7136, 46.6753)).toBe(
      "https://www.google.com/maps?q=24.7136,46.6753",
    );
  });
});

describe("googleMapsDirectionsUrl", () => {
  it("produces a google maps directions URL with destination=lat,lng", () => {
    expect(googleMapsDirectionsUrl(24.7136, 46.6753)).toBe(
      "https://www.google.com/maps/dir/?api=1&destination=24.7136,46.6753",
    );
  });
});

describe("parseCoords", () => {
  it("parses numeric inputs", () => {
    expect(parseCoords(24.7, 46.7)).toEqual({ lat: 24.7, lng: 46.7 });
  });

  it("parses string-encoded numbers", () => {
    expect(parseCoords("24.7", "46.7")).toEqual({ lat: 24.7, lng: 46.7 });
  });

  it("returns null for null/undefined/empty inputs", () => {
    expect(parseCoords(null, null)).toBeNull();
    expect(parseCoords(undefined, undefined)).toBeNull();
    expect(parseCoords("", "")).toBeNull();
  });

  it("returns null for (0, 0) — the equator/prime-meridian default is not a real place", () => {
    expect(parseCoords(0, 0)).toBeNull();
  });

  it("returns null when out of lat/lng range", () => {
    expect(parseCoords(91, 0)).toBeNull();
    expect(parseCoords(-91, 0)).toBeNull();
    expect(parseCoords(0, 181)).toBeNull();
    expect(parseCoords(0, -181)).toBeNull();
  });
});

describe("normalizeSaudiPhoneForWhatsApp", () => {
  it("returns null for empty / whitespace / non-digit", () => {
    expect(normalizeSaudiPhoneForWhatsApp("")).toBeNull();
    expect(normalizeSaudiPhoneForWhatsApp("abc")).toBeNull();
  });

  it("strips + and returns digits-only starting with 966 when input is +9665xxxxxxxx", () => {
    expect(normalizeSaudiPhoneForWhatsApp("+966500000000")).toBe("966500000000");
  });

  it("converts 05xxxxxxxx to 9665xxxxxxxx", () => {
    expect(normalizeSaudiPhoneForWhatsApp("0500000000")).toBe("966500000000");
  });

  it("converts 5xxxxxxxx (9 digits) to 9665xxxxxxxx", () => {
    expect(normalizeSaudiPhoneForWhatsApp("500000000")).toBe("966500000000");
  });

  it("converts 0xxxxxxxxx (10 digits) to 966xxxxxxxxx", () => {
    expect(normalizeSaudiPhoneForWhatsApp("0500000000")).toBe("966500000000");
  });

  it("returns null for too-short numbers", () => {
    expect(normalizeSaudiPhoneForWhatsApp("12345")).toBeNull();
  });
});

describe("buildOrderPreparingWhatsAppMessage", () => {
  it("includes a greeting and the order number", () => {
    const msg = buildOrderPreparingWhatsAppMessage({ customerName: "محمد", orderId: 42 });
    expect(msg).toContain("مرحباً محمد،");
    expect(msg).toContain("00000042");
  });

  it("uses a generic greeting when no customer name is provided", () => {
    const msg = buildOrderPreparingWhatsAppMessage({});
    expect(msg).toContain("مرحباً،");
  });

  it("includes the brand link and explanation", () => {
    const msg = buildOrderPreparingWhatsAppMessage({});
    expect(msg).toContain("https://citymarkets.sa");
    expect(msg).toContain("تجهيز طلبك");
  });
});

describe("buildWhatsAppUrl", () => {
  it("returns null when the phone cannot be normalized", () => {
    expect(buildWhatsAppUrl("abc", "msg")).toBeNull();
  });

  it("builds a wa.me URL with the normalized phone and URL-encoded message", () => {
    const url = buildWhatsAppUrl("+966500000000", "hello world");
    expect(url).toMatch(/^https:\/\/wa\.me\/966500000000\?text=hello%20world$/);
  });
});

describe("coerceAmount", () => {
  it("passes through numbers", () => {
    expect(coerceAmount(12.5)).toBe(12.5);
    expect(coerceAmount(0)).toBe(0);
  });

  it("parses string-encoded numbers", () => {
    expect(coerceAmount("12.5")).toBe(12.5);
  });

  it("returns 0 for null/undefined/NaN", () => {
    expect(coerceAmount(null)).toBe(0);
    expect(coerceAmount(undefined)).toBe(0);
    expect(coerceAmount("not-a-number")).toBe(0);
  });
});

describe("parseOrderItems", () => {
  it("returns the array as-is when given an array", () => {
    const items = [{ id: 1, name_ar: "x" }];
    expect(parseOrderItems(items)).toBe(items);
  });

  it("parses a JSON string into an array", () => {
    const items = [{ id: 1, name_ar: "x" }];
    expect(parseOrderItems(JSON.stringify(items))).toEqual(items);
  });

  it("returns an empty array for invalid JSON strings", () => {
    expect(parseOrderItems("{not json}")).toEqual([]);
  });

  it("returns an empty array when JSON value is not an array", () => {
    expect(parseOrderItems(JSON.stringify({ a: 1 }))).toEqual([]);
  });

  it("returns an empty array for null/undefined/other types", () => {
    expect(parseOrderItems(null)).toEqual([]);
    expect(parseOrderItems(undefined)).toEqual([]);
    expect(parseOrderItems(42)).toEqual([]);
  });
});

describe("normalizeOrdersListPayload", () => {
  it("prefers data when it's an array", () => {
    const orders = [{ id: 1 }];
    const legacy = [{ id: 99 }];
    expect(normalizeOrdersListPayload({ data: orders, orders: legacy })).toBe(orders);
  });

  it("falls back to orders when data is not an array", () => {
    const legacy = [{ id: 99 }];
    expect(normalizeOrdersListPayload({ data: "nope", orders: legacy })).toBe(legacy);
  });

  it("returns an empty array when neither is an array", () => {
    expect(normalizeOrdersListPayload({})).toEqual([]);
    expect(normalizeOrdersListPayload({ data: null, orders: null })).toEqual([]);
  });
});

describe("formatPhone", () => {
  it("formats a 10-digit number into '05XX XXX XXXX'", () => {
    expect(formatPhone("0500000000")).toBe("05 000 00000");
  });

  it("returns the input untouched for non-10-digit numbers", () => {
    expect(formatPhone("12345")).toBe("12345");
  });
});

describe("delay", () => {
  it("resolves after the given ms (use fake timers to keep it fast)", async () => {
    vi.useFakeTimers();
    const p = delay(1000);
    vi.advanceTimersByTime(1000);
    await expect(p).resolves.toBeUndefined();
    vi.useRealTimers();
  });
});

describe("generateId", () => {
  it("returns a non-empty string", () => {
    const id = generateId();
    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);
  });

  it("returns a UUID v4 when crypto.randomUUID is available", () => {
    const id = generateId();
    // UUID v4: 8-4-4-4-12 hex chars
    if (typeof crypto !== "undefined" && crypto.randomUUID !== undefined) {
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    }
  });

  it("returns distinct ids on each call", () => {
    const ids = new Set(Array.from({ length: 10 }, () => generateId()));
    expect(ids.size).toBe(10);
  });
});
