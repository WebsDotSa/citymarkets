import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Regression guard for the proxy.ts ↔ StoreChrome contract.
 *
 * The known bug, recapped from project memory:
 *   - proxy.ts set x-pathname ONLY on `response.headers` (post-cycle).
 *   - Server Components read REQUEST headers via `headers()`.
 *   - result: StoreChrome received empty pathname → `if (!pathname) return null`
 *     → the entire HeaderV2 / BottomNavV2 stack never mounted.
 *
 * The fix moves x-pathname into the `forwardedHeaders` passed to
 * `NextResponse.next({ request: { headers } })`. These checks are
 * intentionally structural (source-level) rather than runtime because
 * proxy.ts depends on cookies, CSRF state, JWT — heavy to unit-test
 * in isolation. We pin the contract here; a developer that touches
 * the forwardedHeaders block will break this test and have to read
 * the memory note explaining why.
 */
describe("proxy.ts → StoreChrome pathname contract", () => {
  const proxySrc = readFileSync(join(process.cwd(), "src/proxy.ts"), "utf8");

  it("forwards x-pathname on the request headers (not just the response)", () => {
    // The contract: forwardedHeaders.set("x-pathname", ...) must exist.
    // Without this, every Server Component reading headers().get("x-pathname")
    // sees undefined.
    const forwardOnForwarded = /forwardedHeaders\.set\(\s*["']x-pathname["']/;
    expect(
      forwardOnForwarded.test(proxySrc),
      "x-pathname must be set on forwardedHeaders (the request side). " +
        "Setting it ONLY on response.headers will not reach Server Components.",
    ).toBe(true);
  });

  it("forwards session-id and nonce on the same forwardedHeaders", () => {
    // Sanity: all three are forwarded together so Server Components
    // can read them in one headers() call.
    expect(proxySrc).toMatch(/forwardedHeaders\.set\(\s*["']x-session-id["']/);
    expect(proxySrc).toMatch(/forwardedHeaders\.set\(\s*["']x-nonce["']/);
  });

  it("StoreChrome does not render chrome when pathname is missing", () => {
    // Pin the defensive early-return: stores that fail to inject
    // x-pathname (e.g. a misconfigured edge case) MUST render null
    // instead of an unguarded header, which would show wrong chrome.
    const storeChrome = readFileSync(
      join(process.cwd(), "src/components/layout/store-chrome.tsx"),
      "utf8",
    );
    expect(storeChrome).toMatch(/if\s*\(\s*!pathname\s*\)\s*return\s+null/);
  });

  it("StoreChrome reads pathname from request headers (next/headers)", () => {
    const storeChrome = readFileSync(
      join(process.cwd(), "src/components/layout/store-chrome.tsx"),
      "utf8",
    );
    expect(storeChrome).toMatch(/await headers\(\)/);
    expect(storeChrome).toMatch(/\.get\(\s*["']x-pathname["']\s*\)/);
  });

  it("exempts the stateless delivery-fee quote and coupon-validate POST endpoints from CSRF", () => {
    // Both are invoked as POST from /cart and /checkout (mobile-first
    // client components) so we can carry lat/lng/code as JSON. They do
    // NOT mutate state — they're read-only calculations. Without these
    // entries the proxy returns 403 with "انتهاك أمان - رمز التحقق
    // غير صالح" and the delivery fee row in the cart shows the CSRF
    // error text instead of a number. Pin both literals here.
    expect(proxySrc).toMatch(/["']\/api\/v1\/delivery\/quote["']/);
    expect(proxySrc).toMatch(/["']\/api\/v1\/coupons\/validate["']/);
  });
});
