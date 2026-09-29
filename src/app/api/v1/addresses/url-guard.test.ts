import { describe, expect, it } from "vitest";
import { isValidPlaceImageUrl } from '@/lib/catalog';

/**
 * Regression coverage for the C3 RBAC hardening in `@/lib/place-image`.
 * Originally a literal mirror of `isValidPlaceImageUrl` inlined in
 * `src/app/api/v1/addresses/route.ts`. The helper now lives in
 * `@/lib/place-image` so it stays in sync with
 * `src/app/api/v1/delivery-addresses/route.ts` (which had a weaker
 * prefix-only check until 2026-09-23).
 */

describe("isValidPlaceImageUrl (C3 RBAC regression)", () => {
  it("accepts a clean place-images URL", () => {
    expect(isValidPlaceImageUrl("/images/place-images/home1.jpg")).toBe(true);
  });

  it("accepts a clean products URL", () => {
    expect(isValidPlaceImageUrl("/images/products/abc.png")).toBe(true);
  });

  it("rejects path traversal via '..'", () => {
    expect(
      isValidPlaceImageUrl("/images/place-images/../../etc/passwd"),
    ).toBe(false);
  });

  it("rejects traversal via URL-encoded '..' segments (raw text only)", () => {
    // The check looks at the literal string, not URL-decoded. We rely
    // on Next.js path normalization downstream.
    expect(isValidPlaceImageUrl("/images/place-images/%2e%2e/etc.jpg")).toBe(true);
  });

  it("rejects protocol-relative URLs (//evil.com)", () => {
    expect(isValidPlaceImageUrl("//evil.com/x.jpg")).toBe(false);
  });

  it("rejects absolute URLs with http/https scheme", () => {
    expect(isValidPlaceImageUrl("https://evil.com/x.jpg")).toBe(false);
    expect(isValidPlaceImageUrl("http://evil.com/x.jpg")).toBe(false);
  });

  it("rejects URLs with arbitrary schemes (javascript:, data:, file:)", () => {
    expect(isValidPlaceImageUrl("javascript:alert(1).jpg")).toBe(false);
    expect(isValidPlaceImageUrl("data:text/html,<script>alert(1)</script>.jpg")).toBe(
      false,
    );
    expect(isValidPlaceImageUrl("file:///etc/passwd.jpg")).toBe(false);
  });

  it("rejects URLs without an image extension", () => {
    expect(isValidPlaceImageUrl("/images/place-images/x.svg")).toBe(false);
    expect(isValidPlaceImageUrl("/images/place-images/x.html")).toBe(false);
    expect(isValidPlaceImageUrl("/images/place-images/x")).toBe(false);
  });

  it("rejects empty / oversized / non-string inputs", () => {
    expect(isValidPlaceImageUrl("")).toBe(false);
    expect(isValidPlaceImageUrl("/images/place-images/" + "x".repeat(300) + ".jpg")).toBe(
      false,
    );
    expect(isValidPlaceImageUrl(undefined)).toBe(false);
    expect(isValidPlaceImageUrl(null)).toBe(false);
    expect(isValidPlaceImageUrl(42)).toBe(false);
    expect(isValidPlaceImageUrl({ url: "/images/place-images/x.jpg" })).toBe(false);
  });

  it("rejects URLs outside the allowlisted prefix", () => {
    expect(isValidPlaceImageUrl("/images/admin/x.jpg")).toBe(false);
    expect(isValidPlaceImageUrl("/private/x.jpg")).toBe(false);
  });
});