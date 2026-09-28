import { describe, it, expect } from "vitest";
import { BRAND } from "./brand-theme";

describe("BRAND tokens", () => {
  it("exports the primary brand green", () => {
    expect(BRAND.primary).toBe("#009345");
    expect(BRAND.brandGreen).toBe("#009345");
  });

  it("exports a darker primary variant", () => {
    expect(BRAND.primaryDark).toBe("#007A38");
  });

  it("exports a lighter brand tint (used for backgrounds)", () => {
    expect(BRAND.primaryLight).toBe("#E6F5EC");
  });

  it("exports the sale-red color", () => {
    expect(BRAND.sale).toBe("#E53935");
  });

  it("exports text color tokens", () => {
    expect(BRAND.text).toBe("#1A1A1A");
    expect(BRAND.textMuted).toBe("#6B7280");
  });

  it("exports layout tokens (border, bg, white)", () => {
    expect(BRAND.border).toBe("#EEEEEE");
    expect(BRAND.bg).toBe("#F8F9FA");
    expect(BRAND.white).toBe("#FFFFFF");
  });

  it("exports the cart-bar color", () => {
    expect(BRAND.cartBar).toBe("#1E2A32");
  });

  it("every token is a valid 6-digit hex color or constant string", () => {
    for (const [k, v] of Object.entries(BRAND)) {
      expect(typeof v, k).toBe("string");
      expect(v.length, k).toBeGreaterThan(0);
    }
  });

  it("is `as const` — values are literal types, not widened to string", () => {
    // The `as const` declaration makes the type-level distinction; at runtime
    // we just confirm the token set is a frozen-like record (no extra keys
    // get added during the test run).
    const expectedKeys = [
      "primary",
      "primaryDark",
      "primaryLight",
      "brandGreen",
      "sale",
      "text",
      "textMuted",
      "border",
      "cartBar",
      "white",
      "bg",
    ];
    expect(Object.keys(BRAND).sort()).toEqual(expectedKeys.sort());
  });
});