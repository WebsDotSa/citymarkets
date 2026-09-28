import { describe, it, expect } from "vitest";
import {
  VENDOR_TYPES,
  VENDOR_TYPE_LABELS_AR,
  isVendorType,
  isAllowedImageUrl,
  HEX_COLOR_RE,
  type VendorType,
} from "./vendors";

describe("VENDOR_TYPES", () => {
  it("contains the legacy core categories", () => {
    expect([...VENDOR_TYPES]).toEqual(
      expect.arrayContaining([
        "food_beverage",
        "fashion",
        "gifts",
        "electronics",
        "services",
      ]),
    );
  });

  it("includes extended merchant categories", () => {
    expect([...VENDOR_TYPES]).toEqual(
      expect.arrayContaining([
        "grocery_supermarket",
        "restaurant_cafe",
        "sweets_bakery",
        "pharmacy_health",
        "beauty_cosmetics",
        "flowers_plants",
        "books_stationery",
        "sports_fitness",
      ]),
    );
  });

  it("includes the 068 electronics-adjacent categories", () => {
    expect([...VENDOR_TYPES]).toEqual(
      expect.arrayContaining([
        "home_appliances",
        "furniture_home",
        "jewelry_watches",
        "cars_auto",
        "pets_animals",
        "kids_babies",
        "music_instruments",
        "tools_industrial",
        "travel_tourism",
        "real_estate",
      ]),
    );
  });
});

describe("VENDOR_TYPE_LABELS_AR", () => {
  it("has a label for every vendor type", () => {
    for (const t of VENDOR_TYPES) {
      expect(VENDOR_TYPE_LABELS_AR[t].length).toBeGreaterThan(0);
    }
  });

  it("uses Arabic for every label", () => {
    for (const [k, v] of Object.entries(VENDOR_TYPE_LABELS_AR)) {
      expect(v, k).toMatch(/[\u0600-\u06FF]/);
    }
  });
});

describe("isVendorType", () => {
  it("returns true for known vendor types", () => {
    expect(isVendorType("food_beverage")).toBe(true);
    expect(isVendorType("services")).toBe(true);
  });

  it("returns false for unknown strings", () => {
    expect(isVendorType("not_a_type")).toBe(false);
    expect(isVendorType("")).toBe(false);
  });

  it("returns false for non-string values", () => {
    expect(isVendorType(undefined)).toBe(false);
    expect(isVendorType(null)).toBe(false);
    expect(isVendorType(42)).toBe(false);
    expect(isVendorType({})).toBe(false);
    expect(isVendorType([])).toBe(false);
  });
});

describe("isAllowedImageUrl", () => {
  it("accepts /images/... paths (any subpath)", () => {
    expect(isAllowedImageUrl("/images/logo.png")).toBe(true);
    expect(isAllowedImageUrl("/images/vendor/abc/cover.jpg")).toBe(true);
  });

  it("accepts /uploads/... paths (the uploader's fallback prefix)", () => {
    expect(isAllowedImageUrl("/uploads/vendors/abc/logo.png")).toBe(true);
    expect(isAllowedImageUrl("/uploads/products/x.jpg")).toBe(true);
  });

  it("rejects root-relative paths outside the allowlist", () => {
    expect(isAllowedImageUrl("/css/style.css")).toBe(false);
    expect(isAllowedImageUrl("/static/x.png")).toBe(false);
    expect(isAllowedImageUrl("/uploads")).toBe(false); // bare, no slash+name
  });

  it("accepts exact hostname matches on the allowlist", () => {
    expect(isAllowedImageUrl("https://images.unsplash.com/x.jpg")).toBe(true);
    expect(isAllowedImageUrl("https://cdn.citymarkets.sa/x.png")).toBe(true);
    expect(isAllowedImageUrl("https://res.cloudinary.com/x.jpg")).toBe(true);
    expect(isAllowedImageUrl("https://citymarkets.sa/images/x.png")).toBe(true);
    expect(isAllowedImageUrl("https://www.citymarkets.sa/images/x.png")).toBe(
      true,
    );
  });

  it("accepts subdomains of allowlisted hosts", () => {
    expect(isAllowedImageUrl("https://user.images.unsplash.com/x.jpg")).toBe(
      true,
    );
    expect(isAllowedImageUrl("https://eu.res.cloudinary.com/x.jpg")).toBe(
      true,
    );
  });

  it("rejects http (non-https) URLs", () => {
    expect(isAllowedImageUrl("http://images.unsplash.com/x.jpg")).toBe(false);
    expect(isAllowedImageUrl("http://citymarkets.sa/images/x.png")).toBe(false);
  });

  it("rejects other protocols (javascript:, data:, ftp:)", () => {
    expect(isAllowedImageUrl("javascript:alert(1)")).toBe(false);
    expect(isAllowedImageUrl("data:image/png;base64,iVBORw0KG")).toBe(false);
    expect(isAllowedImageUrl("ftp://example.com/x.png")).toBe(false);
  });

  it("rejects hosts NOT on the allowlist (no tracking pixels)", () => {
    expect(isAllowedImageUrl("https://evil.example.com/x.png")).toBe(false);
    expect(isAllowedImageUrl("https://google.com/x.png")).toBe(false);
  });

  it("rejects lookalike citymarkets hosts (e.g. citymarkets-sa.com)", () => {
    expect(isAllowedImageUrl("https://citymarkets-sa.com/x.png")).toBe(false);
    expect(isAllowedImageUrl("https://fake.citymarkets.sa.evil.com/x.png")).toBe(
      false,
    );
  });

  it("rejects empty/whitespace-only input", () => {
    expect(isAllowedImageUrl("")).toBe(false);
    expect(isAllowedImageUrl("   ")).toBe(false);
  });

  it("trims surrounding whitespace before evaluating", () => {
    expect(isAllowedImageUrl("  /images/logo.png  ")).toBe(true);
  });

  it("rejects lookalike hosts (e.g. images-unsplash.com is NOT images.unsplash.com)", () => {
    expect(isAllowedImageUrl("https://images-unsplash.com/x.jpg")).toBe(false);
  });
});

describe("HEX_COLOR_RE", () => {
  it("accepts #RGB (3 hex digits)", () => {
    expect(HEX_COLOR_RE.test("#abc")).toBe(true);
    expect(HEX_COLOR_RE.test("#FFF")).toBe(true);
  });

  it("accepts #RRGGBB (6 hex digits)", () => {
    expect(HEX_COLOR_RE.test("#009345")).toBe(true);
    expect(HEX_COLOR_RE.test("#000000")).toBe(true);
    expect(HEX_COLOR_RE.test("#ffffff")).toBe(true);
  });

  it("rejects 4, 5, 7, or 8 hex digits", () => {
    expect(HEX_COLOR_RE.test("#abcd")).toBe(false);
    expect(HEX_COLOR_RE.test("#abcde")).toBe(false);
    expect(HEX_COLOR_RE.test("#abcdef0")).toBe(false);
    expect(HEX_COLOR_RE.test("#abcdef00")).toBe(false);
  });

  it("rejects hex digits outside the allowed range", () => {
    expect(HEX_COLOR_RE.test("#ggg")).toBe(false); // g is not hex
    expect(HEX_COLOR_RE.test("#zzzzzz")).toBe(false);
  });

  it("rejects input without leading #", () => {
    expect(HEX_COLOR_RE.test("009345")).toBe(false);
  });

  it("rejects empty strings", () => {
    expect(HEX_COLOR_RE.test("")).toBe(false);
  });
});

// Suppress unused import warning for VendorType (re-exported for downstream consumers)
void ({} as VendorType);