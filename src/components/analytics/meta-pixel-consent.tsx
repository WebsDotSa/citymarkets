"use client";

import { useEffect } from "react";

declare global {
  interface Window {
    /**
     * Marketing-cookie consent flag set by the consent banner. Read by
     * MetaPixelConsent (to call `fbq('consent', grant|revoke)`) and by
     * the analytics module (to drop fbq calls when consent is denied).
     */
    __META_CONSENT__?: boolean;
  }
}

/**
 * Client-side consent gate for the Meta Pixel.
 *
 * Reads the marketing-cookie consent state from the consent banner
 * (expected to set `window.__META_CONSENT__: boolean`) and:
 *   - On true (or undefined for first-paint before banner shows): allows
 *     the pixel to fire normally. Other Meta-gated calls (analytics
 *     module) read the same flag and no-op when it's false.
 *   - On false: explicitly calls `fbq('consent', 'revoke')` to remove
 *     the pixel from any audience matching this user. Meta processes the
 *     revoke on its side and stops using past data for ad targeting.
 *
 * The MetaPixel component still emits the <Script> regardless of consent
 * state — that's intentional. The pixel base code is tiny (~3 KB) and
 * the SDK needs to be present so that `fbq('consent', ...)` calls work
 * even after the user opts out. If consent was already granted by the
 * time this component mounts, the `consent` call is a no-op.
 *
 * Mount this component inside the body of the root layout (next to the
 * server-rendered <MetaPixel />).
 */
export function MetaPixelConsent() {
  useEffect(() => {
    // First paint: if a previous visit already granted consent, the flag
    // is set before this effect runs (consent banner writes it on
    // mount). If undefined, the user has not decided yet — leave the
    // pixel in its default state until the banner resolves.
    if (typeof window === "undefined" || !window.fbq) return;

    if (window.__META_CONSENT__ === true) {
      window.fbq("consent", "grant");
    } else if (window.__META_CONSENT__ === false) {
      window.fbq("consent", "revoke");
    }
  }, []);

  return null;
}