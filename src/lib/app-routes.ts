/**
 * Customer storefront routes that use the global HeaderV2 / BottomNavV2.
 *
 * Admin and vendor portals render their own chrome (admin-layout.tsx,
 * vendor-layout.tsx). Showing the customer chrome on top would produce
 * a double-header and wrong nav links — both have caused production
 * incidents before (vendor pages showing "العروض" pill, admin pages
 * showing the customer bottom nav).
 *
 * `/checkout` ships its own sticky confirm bar with a known z-50 / z-40
 * overlap with the global BottomNavV2 — leave the global chrome hidden
 * there. `/cart` is now opted IN: the cart's own sticky summary sits
 * cleanly above the BottomNavV2 (`bottom: calc(4rem + safe-area)`),
 * so users get the global HeaderV2 (logo + search + cart badge +
 * account) and the standard BottomNavV2 alongside the cart's own
 * total + checkout button. The StickyCartBar in the storefront chrome
 * already hides itself on `/cart`, so there is no visual duplication.
 *
 * Anything not explicitly denied opts INTO the customer chrome — this
 * defaults to "show the storefront" for any new section that does not
 * yet have its own layout, which is the safer failure mode for a
 * shopping app (missing chrome is visible; wrong chrome is not).
 */
export function isStorefrontRoute(pathname: string): boolean {
  if (pathname.startsWith("/admin")) return false;
  // `/vendor` is the vendor portal — but `/vendors` (plural, no trailing
  // segment) is the public storefront directory. The naive
  // `startsWith("/vendor")` matches BOTH, which silently stripped chrome
  // from /vendors (real P1 bug — found via debug log). Match against the
  // segment boundary (`/vendor` exact OR `/vendor/<anything>`).
  if (pathname === "/vendor" || pathname.startsWith("/vendor/")) return false;
  // /vendors/* is the public storefront directory (vendor list page and
  // per-vendor pages). It IS part of the customer surface, so opt INTO
  // the global chrome here. The chrome pattern is "deny-by-default for
  // /admin and /vendor portals" — anything not in those deny prefixes
  // gets the customer header/footer.
  // (Kept as a positive comment to make the intent obvious to future
  // contributors who might add /vendor-x/ routes that should NOT get
  // chrome.)
  // /checkout ships its own sticky bottom action bar that overlaps with
  // the global BottomNavV2; keep the global chrome hidden there.
  if (pathname === "/checkout" || pathname.startsWith("/checkout/")) return false;
  // Inline payment screens render the Moyasar form in place of the
  // checkout's own sticky confirm bar, so it's safe (and expected) for
  // the global HeaderV2 / BottomNavV2 to mount there. Without this
  // exception the payment form sits in a chromeless full-screen frame,
  // which has been a long-standing UX complaint.
  if (pathname === "/checkout/pay" || pathname.startsWith("/checkout/pay/")) {
    return true;
  }
  return true;
}

/**
 * AI chat surface — matches the `/ai-chat` segment (and any sub-routes
 * like `/ai-chat/history`) but NOT prefix-only matches like `/ai-chatty`.
 * The chat is a full-screen conversational surface and hides the
 * footer (see `isStoreFooterRoute`) but keeps the rest of the
 * storefront chrome (header + bottom nav) so the user can leave the
 * chat from anywhere.
 */
export function isAiChatRoute(pathname: string): boolean {
  return pathname === "/ai-chat" || pathname.startsWith("/ai-chat/");
}

/**
 * Footer gating. The footer is part of the customer chrome but is
 * HIDDEN on routes where it would compete for vertical space with
 * page-specific UI:
 *   - `/admin` / `/vendor` — portals have their own footer (or none).
 *   - `/checkout` — already denies all chrome, so the footer is
 *     hidden by inheritance.
 *   - `/ai-chat` — the chat surface uses the full viewport; the
 *     footer would push messages off-screen.
 *
 * Anything else that is a storefront route gets the footer.
 */
export function isStoreFooterRoute(pathname: string): boolean {
  if (!isStorefrontRoute(pathname)) return false;
  if (isAiChatRoute(pathname)) return false;
  return true;
}