import { describe, expect, it } from "vitest";
import { productUnitPrice } from "./product-price";

describe("productUnitPrice (canonical legacy unit-price rule)", () => {
  it("prefers discount_price, falls back to price", () => {
    expect(productUnitPrice({ price: 10, discount_price: 8 })).toBe(8);
    expect(productUnitPrice({ price: 10, discount_price: null })).toBe(10);
    expect(productUnitPrice({ price: "12.5" })).toBe(12.5);
  });
  it("returns 0 for missing or non-numeric input", () => {
    expect(productUnitPrice({})).toBe(0);
    expect(productUnitPrice({ price: "abc" })).toBe(0);
  });
  it("keeps a zero discount_price (?? semantics, not ||)", () => {
    expect(productUnitPrice({ price: 10, discount_price: 0 })).toBe(0);
  });
});
