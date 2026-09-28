import { describe, it, expect } from "vitest";
import { normalizeSaudiToE164, phoneForDb } from "./phone-format";

describe("normalizeSaudiToE164", () => {
  it("returns null for empty / whitespace input", () => {
    expect(normalizeSaudiToE164("")).toBeNull();
    expect(normalizeSaudiToE164("   ")).toBeNull();
  });

  it("passes through an already-normalized +9665xxxxxxxx number", () => {
    expect(normalizeSaudiToE164("+966500000000")).toBe("+966500000000");
  });

  it("strips spaces and non-digits before normalization", () => {
    // 10-digit local format with spaces: 05XX XXX XXXX
    expect(normalizeSaudiToE164("0500 000 000")).toBe("+966500000000");
  });

  it("converts a local 05xxxxxxxx (10 digits) to +9665xxxxxxxx", () => {
    expect(normalizeSaudiToE164("0500000000")).toBe("+966500000000");
  });

  it("converts a 9-digit 5xxxxxxxx (no leading 0) to +9665xxxxxxxx", () => {
    expect(normalizeSaudiToE164("500000000")).toBe("+966500000000");
  });

  it("converts a 10-digit 5xxxxxxxx to +9665xxxxxxxx (without dropping the leading 5)", () => {
    // 10 digits starting with 5 are treated as already-international format minus the +
    expect(normalizeSaudiToE164("5000000000")).toBe("+9665000000000");
  });

  it("accepts a raw 966xxxxxxxxx (>=12 digits) and adds +", () => {
    expect(normalizeSaudiToE164("966500000000")).toBe("+966500000000");
  });

  it("returns null for numbers that don't match any Saudi pattern", () => {
    expect(normalizeSaudiToE164("12345")).toBeNull();
    expect(normalizeSaudiToE164("+15551234567")).toBeNull();
  });
});

describe("phoneForDb", () => {
  it("adds a leading + when missing", () => {
    expect(phoneForDb("966500000000")).toBe("+966500000000");
  });

  it("passes through an already-+ prefixed number", () => {
    expect(phoneForDb("+966500000000")).toBe("+966500000000");
  });

  it("idempotent: phoneForDb(phoneForDb(x)) === phoneForDb(x)", () => {
    const once = phoneForDb("966500000000");
    expect(phoneForDb(once)).toBe(once);
  });
});
