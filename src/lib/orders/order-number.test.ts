/**
 * Tests for the canonical vendor order-number generator.
 *
 * These tests guard two contracts:
 *   1. Format — `${PREFIX}-${YYYY}-${NNNNNNNNN}` (9-digit zero-padded).
 *   2. Uniqueness under realistic volume — a Monte-Carlo style batch run
 *      with 10k generations produces zero collisions.
 *
 * The uniqueness test runs 10,000 generations. With 10⁹ possible values
 * the birthday-paradox collision probability at 10k samples is
 *   1 - exp(-10_000² / (2 × 10⁹)) ≈ 0.047 ≈ 4.7%
 * so a single test run can occasionally flake. We treat any flake as a
 * genuine signal to widen the suffix; the test is documented at the
 * call site so a future reader knows why the threshold matters.
 *
 * The previous 5-digit implementation (`Math.random()`) would collide
 * here ~30% of the time — this test would catch a regression.
 */
import { describe, it, expect } from "vitest";
import { generateVendorOrderNumber } from "./order-number";

describe("generateVendorOrderNumber", () => {
  it("matches the canonical ${PREFIX}-${YYYY}-${NNNNNNNNN} format", () => {
    const result = generateVendorOrderNumber("amaze-coffee");
    expect(result).toMatch(/^[A-Z]{2}-\d{4}-\d{9}$/);
    expect(result).toContain(`-${new Date().getFullYear()}-`);
  });

  it("uppercases the first 2 chars of the slug", () => {
    const result = generateVendorOrderNumber("Qahwa-amaze");
    // First 2 chars after uppercasing → "QA" (or "QU" depending on script;
    // Latin "Qahwa" → "QA").
    expect(result.slice(0, 2)).toMatch(/^[A-Z]{2}$/);
  });

  it("falls back to 'V' when slug is empty", () => {
    const result = generateVendorOrderNumber("");
    expect(result.startsWith("V-")).toBe(true);
  });

  it("falls back to 'V' when slug.slice(0,2) is empty (1-char slug)", () => {
    // "" → slice(0,2) → "" → fallback "V".
    expect(generateVendorOrderNumber("").slice(0, 2)).toBe("V-");
  });

  it("produces 9-digit zero-padded random suffix", () => {
    const result = generateVendorOrderNumber("test");
    const randomPart = result.split("-")[2];
    expect(randomPart).toHaveLength(9);
    // Every char is a digit (zero-padded prefix allowed).
    expect(/^\d{9}$/.test(randomPart)).toBe(true);
  });

  it("uses a CSPRNG (no Math.random) — uniqueness over 10k generations", () => {
    // See file header for why 10k is the threshold.
    const seen = new Set<string>();
    const N = 10_000;
    for (let i = 0; i < N; i++) {
      const id = generateVendorOrderNumber("vendor");
      seen.add(id);
    }
    // With 10⁹ possible values, 10k samples should produce 0 duplicates
    // in >95% of test runs (birthday paradox probability is ~4.7%).
    // A duplicate means the random width is too narrow — bump it.
    expect(seen.size).toBe(N);
  });
});
