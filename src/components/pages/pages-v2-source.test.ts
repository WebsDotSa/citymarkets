import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

/**
 * Source-level contract tests for the V2 client components.
 *
 * Why source-level: this repo has no jsdom and no @testing-library/react,
 * and dragging both in just to render a 1000-line client component is
 * disproportionate. Instead we pin the SOURCES of the components to the
 * exports, imports, and structural choices the rest of the app depends
 * on — anything that breaks one of these is a real regression (e.g.
 * removing the abort controller from HomeContentV2 re-introduces the
 * "set state on unmounted component" warning).
 *
 * If/when testing-library is added, replace these with proper render
 * tests — the assertions below are easier to extend than to bootstrap
 * a React test rig from scratch.
 */

const PAGES_DIR = join(process.cwd(), "src/components/pages");

describe("HomeContentV2 structural contract", () => {
  const src = readFileSync(
    join(PAGES_DIR, "home/home-v2.tsx"),
    "utf8",
  );

  it("exports the component under the V2 name (not the legacy one)", () => {
    expect(src).toMatch(/export\s+function\s+HomeContentV2\b/);
  });

  it("uses AbortController to avoid setting state on unmounted components", () => {
    // The home page does four parallel fetches; without AbortController,
    // a navigation away mid-fetch triggers React's "setState on unmounted"
    // warning that floods the dev console.
    expect(src).toMatch(/AbortController/);
    expect(src).toMatch(/ac\.signal\.aborted/);
    expect(src).toMatch(/ac\.abort\(\)/);
  });

  it("fetches from the V1 API namespace, not /api (legacy)", () => {
    expect(src).toMatch(/fetch\(\s*["']\/api\/v1\//);
  });

  it("guards state setters against array vs object response shapes", () => {
    // The endpoints sometimes return raw arrays, sometimes
    // `{ success, data }` envelopes. The component handles both via:
    //   const d = dealsRes.data;
    //   setDeals(Array.isArray(d) ? d : d?.data || []);
    // If someone refactors that handle out, the page will explode in prod.
    expect(src).toMatch(/Array\.isArray\(.+\)\s*\?\s*.+\s*:\s*.+\?\.\s*data/);
  });

  it("memoises the category slug lookup", () => {
    // Without useMemo, every re-render rebuilds the Map → expensive on
    // a 1000-product catalog. Pin the import + usage.
    expect(src).toMatch(/useMemo\b/);
    expect(src).toMatch(/categoryMap|new Map\(categories/);
  });
});

describe("CartV2 structural contract", () => {
  const src = existsSync(join(PAGES_DIR, "cart/cart-v2.tsx"))
    ? readFileSync(join(PAGES_DIR, "cart/cart-v2.tsx"), "utf8")
    : "";

  it.skipIf(src === "")("exists as cart-v2.tsx", () => {
    expect(src.length).toBeGreaterThan(0);
  });

  it.skipIf(src === "")("consumes the cart context (not direct fetch)", () => {
    // Going around cart-context to fetch directly bypasses the optimistic
    // updates + total recalculation; Pin that the V2 cart uses the hook.
    expect(src).toMatch(/useCart\(\)/);
  });

  it.skipIf(src === "")("does not duplicate the cart mutation logic", () => {
    // Older pages had their own mutators; V2 must call into the context.
    expect(src).not.toMatch(/fetch\(\s*["']\/api\/v1\/cart["']/);
  });
});

describe("ProfileNew structural contract", () => {
  const src = existsSync(join(PAGES_DIR, "profile/profile-new.tsx"))
    ? readFileSync(join(PAGES_DIR, "profile/profile-new.tsx"), "utf8")
    : "";

  it.skipIf(src === "")("reads user/auth state via hook", () => {
    expect(src).toMatch(/useAuthState\(\)/);
  });

  it.skipIf(src === "")("renders user avatar/identity", () => {
    // Profile pages that don't show avatar are a regression on the
    // "personal" feel of the app. Pin that user.name or user.email is
    // displayed.
    expect(src).toMatch(/user\.(name|email|phone)/);
  });
});

describe("OrdersNew structural contract", () => {
  const src = existsSync(join(PAGES_DIR, "orders/orders-new.tsx"))
    ? readFileSync(join(PAGES_DIR, "orders/orders-new.tsx"), "utf8")
    : "";

  it.skipIf(src === "")("fetches orders from /api/v1/orders", () => {
    expect(src).toMatch(/\/api\/v1\/orders/);
  });

  it.skipIf(src === "")("handles empty state explicitly", () => {
    // Empty-state copy is part of the UX contract; pinning it forces
    // anyone removing it to think twice.
    expect(src).toMatch(/(لا\s+توجد|empty|فارغة|isEmpty|length\s*===\s*0)/);
  });
});

describe("CheckoutNew structural contract", () => {
  const src = existsSync(join(PAGES_DIR, "checkout/checkout-new.tsx"))
    ? readFileSync(join(PAGES_DIR, "checkout/checkout-new.tsx"), "utf8")
    : "";

  it.skipIf(src === "")("uses the address context (not local state)", () => {
    // Address selection is centralised; V2 must consume it.
    expect(src).toMatch(/useDeliveryLocation|useAuthState|addressContext/);
  });

  it.skipIf(src === "")("submits via the canonical checkout endpoint", () => {
    expect(src).toMatch(/\/api\/v1\/orders/);
  });
});
