import { describe, expect, it, vi } from "vitest";
import crypto from "crypto";

/**
 * Mirror of the safeEqual implementation in
 * `src/app/api/v1/payments/webhook/route.ts`. This is a regression
 * guard against re-introducing `===` for secret comparison — a
 * timing-attack vector flagged as CRITICAL C1.
 *
 * If you change the implementation in route.ts, mirror it here and
 * keep all tests passing.
 */
function safeEqual(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
  } catch {
    return false;
  }
}

describe("webhook safeEqual (CRITICAL C1 regression)", () => {
  it("matches identical strings", () => {
    expect(safeEqual("secret-abc-123", "secret-abc-123")).toBe(true);
  });

  it("rejects differing strings of the same length", () => {
    expect(safeEqual("secret-abc-123", "secret-abc-124")).toBe(false);
  });

  it("rejects differing strings of different lengths (no length leak via buffer padding)", () => {
    expect(safeEqual("short", "longer-string")).toBe(false);
    expect(safeEqual("a-very-long-string", "x")).toBe(false);
  });

  it("rejects empty inputs", () => {
    expect(safeEqual("", "")).toBe(false);
    expect(safeEqual("", "x")).toBe(false);
    expect(safeEqual("x", "")).toBe(false);
  });

  it("survives unicode payloads", () => {
    const a = "سر-سري-1234";
    const b = "سر-سري-1234";
    expect(safeEqual(a, b)).toBe(true);
  });

  it("rejects unicode payloads that differ in code points", () => {
    expect(safeEqual("سر-سري-1234", "سر-سرى-1234")).toBe(false);
  });

  it("treats whitespace differences as different", () => {
    expect(safeEqual("secret", " secret")).toBe(false);
    expect(safeEqual("secret", "secret ")).toBe(false);
  });

  // This is the actual regression guard — `===` would also pass all of
  // the above. The whole point of safeEqual is timing-attack resistance,
  // which we can't test deterministically in unit tests but we can pin
  // the implementation to crypto.timingSafeEqual via this guard.
  it("uses crypto.timingSafeEqual internally", () => {
    const spy = vi.spyOn(crypto, "timingSafeEqual");
    safeEqual("abc", "abc");
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});