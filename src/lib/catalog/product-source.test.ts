import { describe, expect, it } from "vitest";
import {
  CITY_MARKETS_VENDOR_ID,
  isCityMarketsVendor,
  parseProductCartKey,
  productCartKey,
  vendorFieldsFromProduct,
} from "@/lib/catalog/product-source";

describe("isCityMarketsVendor", () => {
  it("returns true for the canonical City Markets pseudo-vendor UUID", () => {
    expect(isCityMarketsVendor(CITY_MARKETS_VENDOR_ID)).toBe(true);
  });

  it("treats null and undefined as City Markets (legacy catalog fallback)", () => {
    // Pre-Slice-1 product records never set vendor_id; the cart
    // context normalises those to the catalog checkout path.
    expect(isCityMarketsVendor(null)).toBe(true);
    expect(isCityMarketsVendor(undefined)).toBe(true);
  });

  it("returns false for any third-party vendor UUID", () => {
    expect(isCityMarketsVendor("11111111-1111-1111-1111-111111111111")).toBe(false);
    expect(isCityMarketsVendor("qahwa-amaze")).toBe(false);
  });

  it("treats an empty string the same as null (no vendor info → catalog)", () => {
    // Defensive: an empty string slips through from optional form
    // fields. Treat it the same as null/undefined.
    expect(isCityMarketsVendor("")).toBe(true);
  });
});

describe("productCartKey", () => {
  it("joins vendor id and product id with a stable separator", () => {
    expect(productCartKey("p1", "v1")).toBe("v1::p1");
  });

  it("defaults the vendor id to City Markets when null/undefined", () => {
    // Legacy cart items that pre-date Slice 1 lack vendor_id; the
    // composite key MUST still be deterministic so removeItem /
    // updateQuantity continue to work after a backward-compatible
    // upgrade.
    expect(productCartKey("p1", null)).toBe(`${CITY_MARKETS_VENDOR_ID}::p1`);
    expect(productCartKey("p1", undefined)).toBe(`${CITY_MARKETS_VENDOR_ID}::p1`);
  });

  it("disambiguates two products sharing the same UUID across vendors", () => {
    const a = productCartKey("dup-id", "vendor-a");
    const b = productCartKey("dup-id", "vendor-b");
    expect(a).not.toBe(b);
  });
});

describe("parseProductCartKey", () => {
  it("splits a composite key back into vendor + product", () => {
    expect(parseProductCartKey("v1::p1")).toEqual({
      vendorId: "v1",
      productId: "p1",
    });
  });

  it("falls back to City Markets when the key has no separator (legacy format)", () => {
    // Old carts stored plain product ids without a vendor prefix.
    // Parsing must succeed — the caller then treats the row as a
    // catalog item.
    expect(parseProductCartKey("p1")).toEqual({
      vendorId: CITY_MARKETS_VENDOR_ID,
      productId: "p1",
    });
  });

  it("handles UUIDs containing colons gracefully", () => {
    const { vendorId, productId } = parseProductCartKey(
      `${CITY_MARKETS_VENDOR_ID}::abc-def`,
    );
    expect(vendorId).toBe(CITY_MARKETS_VENDOR_ID);
    expect(productId).toBe("abc-def");
  });
});

describe("vendorFieldsFromProduct", () => {
  it("copies vendor provenance off a Product into a CartItem-shaped bag", () => {
    const result = vendorFieldsFromProduct({
      vendor_id: "v1",
      vendor_slug: "almarai",
      vendor_name: "المراعي",
    });
    expect(result).toEqual({
      vendor_id: "v1",
      vendor_slug: "almarai",
      vendor_name: "المراعي",
    });
  });

  it("normalises missing fields to null", () => {
    const result = vendorFieldsFromProduct({});
    expect(result).toEqual({
      vendor_id: null,
      vendor_slug: null,
      vendor_name: null,
    });
  });
});

describe("CITY_MARKETS_VENDOR_ID", () => {
  it("matches the UUID documented in migration 014", () => {
    // Migration 014 used the all-zeros UUID as the pseudo-vendor for
    // backfilled `products` rows. Changing this would orphan every
    // existing vendor_products row that points at the catalog.
    expect(CITY_MARKETS_VENDOR_ID).toBe("00000000-0000-0000-0000-000000000001");
  });
});
