import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  isAiChatRoute,
  isStoreFooterRoute,
  isStorefrontRoute,
} from "./app-routes";

/**
 * Storefront/header gating. StoreChrome uses this to decide whether to
 * render <HeaderV2 /> and <BottomNavV2 /> — admin/vendor pages must NOT
 * receive the customer header/nav because they have their own chrome
 * (admin-layout.tsx, driver-layout.tsx, vendor-layout.tsx).
 *
 * `/checkout` has to opt out because it ships its own sticky bottom
 * action bar (z-40) — keeping the global BottomNavV2 (z-50) on top
 * hides the page's own confirm button. `/cart` is now opted IN: its
 * sticky summary is positioned at `bottom: calc(4rem + safe-area)` so
 * it sits cleanly above the BottomNavV2, and the StickyCartBar in
 * StoreChrome self-hides on /cart, so there is no visual duplication.
 * See proxy.ts + checkout-new.tsx for the layout contract.
 *
 * Adding a new admin sub-section used to silently inherit the customer
 * chrome (a real incident this guards against — see migration 013 RLS).
 */
describe("isStorefrontRoute", () => {
  it("treats the homepage as a storefront route", () => {
    expect(isStorefrontRoute("/")).toBe(true);
  });

  it("treats root customer surfaces as storefront routes", () => {
    expect(isStorefrontRoute("/catalog")).toBe(true);
    expect(isStorefrontRoute("/catalog?deals=true")).toBe(true);
    expect(isStorefrontRoute("/products/123")).toBe(true);
    expect(isStorefrontRoute("/orders")).toBe(true);
    expect(isStorefrontRoute("/profile")).toBe(true);
    expect(isStorefrontRoute("/cart")).toBe(true);
  });

  it("hides chrome on admin routes (any sub-path)", () => {
    expect(isStorefrontRoute("/admin")).toBe(false);
    expect(isStorefrontRoute("/admin/orders")).toBe(false);
    expect(isStorefrontRoute("/admin/login")).toBe(false);
    expect(isStorefrontRoute("/admin/drivers/edit/42")).toBe(false);
  });

  it("hides chrome on vendor routes", () => {
    expect(isStorefrontRoute("/vendor")).toBe(false);
    expect(isStorefrontRoute("/vendor/almarai/admin")).toBe(false);
  });

  it("treats the /vendors public directory as a storefront route", () => {
    // Regression: the previous `startsWith("/vendor")` check matched
    // `/vendors` (plural) too, silently stripping chrome from the
    // public store directory. Match the segment boundary.
    expect(isStorefrontRoute("/vendors")).toBe(true);
    expect(isStorefrontRoute("/vendors/almarai")).toBe(true);
  });

  it("hides the global nav on checkout (it ships its own confirm bar)", () => {
    // The global BottomNavV2 (z-50) sits on top of the checkout's
    // confirm bar (z-40), making "تأكيد الطلب" untappable. Pin the
    // deny here so a future refactor of BottomNavV2 cannot silently
    // re-introduce the bug.
    expect(isStorefrontRoute("/checkout")).toBe(false);
    expect(isStorefrontRoute("/checkout/success")).toBe(false);
    expect(isStorefrontRoute("/checkout/error")).toBe(false);
  });

  it("returns true for unknown prefixes by default (defensive: don't break new pages)", () => {
    // The function opts out of /admin, /vendor, /checkout. If we
    // add a new section we WANT chrome on it until a layout.tsx is
    // shipped. New admin routes must be added to the explicit deny list.
    expect(isStorefrontRoute("/new-feature")).toBe(true);
  });
});

describe("isAiChatRoute", () => {
  it("matches only the ai-chat segment", () => {
    expect(isAiChatRoute("/ai-chat")).toBe(true);
    expect(isAiChatRoute("/ai-chat/history")).toBe(true);
    expect(isAiChatRoute("/ai-chatty")).toBe(false);
    expect(isAiChatRoute("/catalog?ref=ai-chat")).toBe(false);
  });
});

describe("isStoreFooterRoute", () => {
  it("keeps the storefront chrome but hides the footer on ai-chat", () => {
    expect(isStorefrontRoute("/ai-chat")).toBe(true);
    expect(isStoreFooterRoute("/ai-chat")).toBe(false);
    expect(isStoreFooterRoute("/ai-chat/history")).toBe(false);
  });

  it("keeps the footer on normal storefront routes", () => {
    expect(isStoreFooterRoute("/")).toBe(true);
    expect(isStoreFooterRoute("/catalog")).toBe(true);
    expect(isStoreFooterRoute("/ai-chatty")).toBe(true);
    expect(isStoreFooterRoute("/vendors")).toBe(true);
  });

  it("keeps the footer hidden where storefront chrome is hidden", () => {
    expect(isStoreFooterRoute("/admin")).toBe(false);
    expect(isStoreFooterRoute("/vendor/store/admin")).toBe(false);
    expect(isStoreFooterRoute("/checkout")).toBe(false);
  });
});

/**
 * Regression guard for the redirect-to-canonical conversion.
 *
 * proxy.ts (middleware) intercepts Server Component redirect() calls
 * and turns them into 200 responses with the redirect body in some
 * Next.js 16 setups. The fix is to render the duplicate URL with a
 * canonical link + noindex meta instead. This test walks every
 * src/app/**+page.tsx (recursive) and fails if any storefront-classified route
 * still calls redirect() — admin/vendor/cart/checkout are exempt
 * because they have their own layouts and are not subject to the same
 * proxy quirk.
 */
function walkAppPages(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    // Skip private / build / hidden dirs so the walker stays scoped to
    // routes Next.js actually compiles.
    if (entry.startsWith(".") || entry === "node_modules") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walkAppPages(full, out);
    } else if (entry === "page.tsx") {
      out.push(full);
    }
  }
  return out;
}

describe("storefront pages must not call redirect()", () => {
  const appRoot = join(process.cwd(), "src", "app");
  const pages = walkAppPages(appRoot);

  it("finds at least one app page to scan (sanity check)", () => {
    expect(pages.length).toBeGreaterThan(0);
  });

  // Derive the route from each file path, then filter down to
  // storefront-classified routes so we only assert on the routes that
  // are subject to the proxy.ts redirect quirk.
  const cases = pages
    .map((p) => {
      const prefix = appRoot + "/";
      const rel = p.startsWith(prefix) ? p.slice(prefix.length) : p;
      const stripped = rel.replace(/\/page\.tsx$/, "");
      const segments = stripped.split("/");
      // The first concrete path segment determines the route family.
      // Bracket groups like (dashboard) are route groups and don't
      // appear in the URL — skip them.
      const concrete = segments.find((s) => s.length > 0 && !s.startsWith("("));
      const route = "/" + (concrete ?? "");
      return { file: p, route };
    })
    .filter((c) => isStorefrontRoute(c.route));

  it.each(cases)("$route does not call redirect()", ({ file }) => {
    const content = readFileSync(file, "utf8");
    // Strip block comments and line comments before matching so the
    // test only catches real code references, not the words used in
    // explanatory comments.
    const stripped = content
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(stripped).not.toMatch(/\bredirect\s*\(/);
  });
});
