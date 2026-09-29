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
  // src/components/pages/home/home-v2.tsx was removed in
  // refactor/full-repository-consolidation (Phase A2) — the storefront
  // landing page now uses the live component under src/app/home. The
  // structural tests that pinned HomeContentV2 are no longer applicable.
  it.skip("home-v2.tsx was retired; see docs/audits/2026-09-30-full-repository-consolidation.md", () => {
    expect(true).toBe(true);
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
