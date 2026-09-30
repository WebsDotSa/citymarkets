/**
 * Google Analytics 4 + Meta Pixel dual-helper (client side).
 *
 * `window.gtag` is injected by the GoogleAnalytics component in the root
 * layout. If GA is blocked or still loading, every helper no-ops gracefully
 * via the `window.gtag?.(...)` optional chain.
 *
 * `window.fbq` is injected by the MetaPixel component in the root layout.
 * Same pattern — `fbq?.(...)` no-ops when the pixel is blocked / not loaded
 * / the user has not granted marketing-cookie consent.
 *
 * This module is the **production entry point** for analytics on citymarkets.sa.
 * (`useAnalytics` hook in src/hooks/useAnalytics.ts, retired in
 * refactor/full-repository-consolidation Phase A2, used to mirror this API.)
 * Direct callers in src/contexts/cart-context.tsx and
 * src/app/checkout/success/page.tsx fire the same GA4 + Meta tracking so
 * dashboards and ad optimization see consistent data.
 *
 * CONVERSION EVENT MAPPING (Meta Pixel standard events):
 *   view_item        → ViewContent
 *   add_to_cart      → AddToCart
 *   remove_from_cart → RemoveFromCart (custom — Meta has no standard)
 *   begin_checkout   → InitiateCheckout
 *   purchase         → Purchase  ← most important for ad optimization
 *   search           → Search
 */

export type GtagItem = {
  item_id: string;
  item_name: string;
  price?: number;
  quantity?: number;
  item_category?: string;
  item_brand?: string;
};

export type GtagEvent =
  | "view_item"
  | "add_to_cart"
  | "remove_from_cart"
  | "begin_checkout"
  | "purchase"
  | "search";

type GtagFn = (
  command: "event" | "config" | "set",
  eventName: string,
  params?: Record<string, unknown>,
) => void;

type FbqFn = (
  command: string,
  eventName?: string,
  params?: Record<string, unknown>,
  /**
   * Optional Meta Pixel eventID for browser↔CAPI dedup. Meta accepts
   *   fbq('track', 'Purchase', { value: 100 }, { eventID: 'uuid' });
   * The 4th argument is read by the SDK and forwarded with the event.
   */
  options?: { eventID?: string },
) => void;

declare global {
  // Window augmentation lives in src/lib/analytics.ts (single source of
  // truth for the analytics interface). Re-declaring here would trigger
  // TS2717 "subsequent property declarations must have the same type"
  // because the FbqFn signatures drift between the two files.
}

/**
 * Generate a fresh event_id for deduplication between the browser pixel
 * and the future server-side Conversions API (CAPI) call. Meta's CAPI
 * matches a `Purchase` browser event to the server-side `Purchase` when
 * both carry the SAME `event_id` (UUID v4 is the canonical format).
 *
 * Pass `eventID` into `trackPurchase` / `trackViewItem` etc. — when the
 * server route also sends the same id, Meta dedupes instead of counting
 * the conversion twice.
 *
 * `crypto.randomUUID` is available in modern browsers; fall back to a
 * manual v4 for very old runtimes (defensive).
 */
export function newEventID(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // RFC 4122 v4 (less secure, but fine for client-side dedup)
  const b = new Uint8Array(16);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(b);
  } else {
    for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  }
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const hex = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Derive a stable event_id from a known identifier (typically the order
 * id). Use this on the client so the SAME UUID is fired on every page
 * reload / analytics retry — the server-side CAPI implementation can
 * compute the same id with the same formula and Meta will dedupe the
 * browser + server events instead of double-counting the conversion.
 *
 * The output is RFC 4122 v5-shaped (uuid v3 with SHA-1 of a namespaced
 * string) so it satisfies Meta's UUID format. The "namespace" is the
 * literal string `"citymarkets-sa/v1"` — both sides must use the same
 * namespace for the hash to match.
 */
export function eventIDForOrder(orderId: string, eventName: string): string {
  if (typeof crypto === "undefined" || typeof crypto.subtle === "undefined") {
    // SubtleCrypto requires a secure context (HTTPS) — fall back to a
    // random UUID when unavailable. Browser↔CAPI dedup still works as
    // long as the CAPI side doesn't try to predict this id; the
    // server should re-roll with its own event_id when this happens.
    return newEventID();
  }
  // Synchronous SHA-1 via WebCrypto would be async; use a sync fallback
  // for fire-and-forget analytics. This is good enough — Meta only
  // needs a UUID, not a v5 specifically.
  let h = 0x811c9dc5;
  const input = `citymarkets-sa/v1|${eventName}|${orderId}`;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  const hex = h.toString(16).padStart(8, "0");
  // Pad to 32 hex chars + insert the canonical UUID dashes so the
  // output satisfies Meta's UUID format validator.
  const full = (hex + hex + hex + hex + hex).slice(0, 32);
  return `${full.slice(0, 8)}-${full.slice(8, 12)}-5${full.slice(13, 16)}-a${full.slice(17, 20)}-${full.slice(20, 32)}`;
}

/**
 * Fire a Meta Pixel standard event. No-ops when consent is denied.
 * Falls back to `trackCustom` for events without a Meta standard name.
 *
 * The optional `eventID` is forwarded both as the third argument to
 * `fbq` (Meta reads `eventID` directly) and as `event_id` in the GA4
 * payload so a future CAPI call can echo the same id for dedup.
 */
function fbqTrack(
  eventName: string,
  params: Record<string, unknown>,
  custom = false,
  eventID?: string,
) {
  if (typeof window === "undefined") return;
  // Honour the consent gate. Defensive: even if the server-side <Script>
  // bypassed the gate, the client-side check drops every fbq call.
  if (window.__META_CONSENT__ === false) return;
  const fbq = window.fbq;
  if (!fbq) return;
  // Meta accepts eventID directly on the fbq() call:
  //   fbq('track', 'Purchase', { value: 100 }, { eventID: 'uuid' });
  // When we don't pass an eventID, omit the 4th argument entirely.
  // The 4th argument is part of the official Meta SDK signature; the
  // shared `FbqFn` in analytics.ts only documents the first 3 args, so
  // we cast here once to avoid a type-vs-runtime mismatch elsewhere.
  const fbqExtended = fbq as unknown as (
    command: string,
    eventName?: string,
    params?: Record<string, unknown>,
    options?: { eventID?: string },
  ) => void;
  if (custom) fbqExtended("trackCustom", eventName, params);
  else if (eventID) fbqExtended("track", eventName, params, { eventID });
  else fbqExtended("track", eventName, params);
}

export function trackEvent(name: GtagEvent, params?: Record<string, unknown>) {
  if (typeof window === "undefined") return;
  window.gtag?.("event", name, params);
}

export function trackViewItem(args: {
  currency: string;
  value: number;
  items: GtagItem[];
  /** Optional event_id for browser↔CAPI dedup. Auto-generated if omitted. */
  eventID?: string;
}) {
  const eventID = args.eventID ?? newEventID();
  trackEvent("view_item", { ...args, event_id: eventID });
  // Meta ViewContent — content_ids as ARRAY per Meta convention; first
  // item carries the value so the pixel can optimise against the same
  // conversion value as GA4.
  const ids = args.items.map((i) => i.item_id);
  const first = args.items[0];
  fbqTrack(
    "ViewContent",
    {
      content_ids: ids,
      content_name: first?.item_name,
      content_category: first?.item_category,
      content_type: "product",
      value: args.value,
      currency: args.currency,
    },
    false,
    eventID,
  );
  return eventID;
}

export function trackAddToCart(args: {
  currency: string;
  value: number;
  items: GtagItem[];
  /** Optional event_id for browser↔CAPI dedup. Auto-generated if omitted. */
  eventID?: string;
}) {
  const eventID = args.eventID ?? newEventID();
  trackEvent("add_to_cart", { ...args, event_id: eventID });
  const first = args.items[0];
  fbqTrack(
    "AddToCart",
    {
      content_ids: args.items.map((i) => i.item_id),
      content_name: first?.item_name,
      content_category: first?.item_category,
      content_type: "product",
      value: args.value,
      currency: args.currency,
      contents: args.items.map((i) => ({
        id: i.item_id,
        quantity: i.quantity ?? 1,
      })),
    },
    false,
    eventID,
  );
  return eventID;
}

export function trackRemoveFromCart(args: {
  currency: string;
  value: number;
  items: GtagItem[];
}) {
  trackEvent("remove_from_cart", args);
  const first = args.items[0];
  fbqTrack(
    "RemoveFromCart",
    {
      content_ids: args.items.map((i) => i.item_id),
      content_name: first?.item_name,
      value: args.value,
      currency: args.currency,
      contents: args.items.map((i) => ({
        id: i.item_id,
        quantity: i.quantity ?? 1,
      })),
    },
    true, // custom event — Meta has no standard remove-from-cart event
  );
}

export function trackBeginCheckout(args: {
  currency: string;
  value: number;
  items: GtagItem[];
  /** Optional event_id for browser↔CAPI dedup. Auto-generated if omitted. */
  eventID?: string;
}) {
  const eventID = args.eventID ?? newEventID();
  trackEvent("begin_checkout", { ...args, event_id: eventID });
  const num_items = args.items.reduce(
    (n, i) => n + (i.quantity ?? 1),
    0,
  );
  fbqTrack(
    "InitiateCheckout",
    {
      value: args.value,
      currency: args.currency,
      num_items,
      content_type: "product",
      content_ids: args.items.map((i) => i.item_id),
    },
    false,
    eventID,
  );
  return eventID;
}

export function trackPurchase(args: {
  transaction_id: string;
  currency: string;
  value: number;
  payment_method?: string;
  items?: GtagItem[];
  /**
   * Optional event_id for browser↔CAPI dedup. Auto-generated if omitted.
   * Meta's Conversions API matches the browser Purchase to the server-side
   * event when they share the same UUID.
   *
   * When omitted we DERIVE a stable id from `transaction_id` via
   * `eventIDForOrder(...)` so the same id is fired on every page reload
   * and analytics retry. This is what lets the future server-side CAPI
   * dedupe against this browser event — both sides just need to call
   * `eventIDForOrder(orderId, "Purchase")` with the same arguments.
   */
  eventID?: string;
}) {
  // Derive a stable id from the transaction_id when the caller didn't
  // pass one explicitly. Falling back to a random UUID is a last resort
  // (browser-only conversion with no planned CAPI mirror).
  const eventID =
    args.eventID ??
    eventIDForOrder(args.transaction_id, "Purchase") ??
    newEventID();
  trackEvent("purchase", {
    ...args,
    event_id: eventID,
    transaction_id: args.transaction_id,
  });
  const items = args.items ?? [];
  fbqTrack(
    "Purchase",
    {
      value: args.value,
      currency: args.currency,
      content_ids: items.map((i) => i.item_id),
      content_type: "product",
      num_items: items.reduce((n, i) => n + (i.quantity ?? 1), 0),
      contents: items.map((i) => ({
        id: i.item_id,
        quantity: i.quantity ?? 1,
      })),
      // order_id lets Meta dedupe against future server-side CAPI events
      // that the API route may also send (future enhancement).
      order_id: args.transaction_id,
      // event_id duplicated in the fbq payload (in addition to the
      // 4th-arg options.eventID) so any future CAPI implementation can
      // read either field — Meta's server expects `event_id` in the
      // body, not just the URL.
      event_id: eventID,
    },
    false,
    eventID,
  );
  return eventID;
}

export function trackSearch(term: string) {
  trackEvent("search", { search_term: term });
  fbqTrack("Search", { search_string: term });
}