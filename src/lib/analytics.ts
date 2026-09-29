/**
 * Analytics module — Google Analytics 4 (gtag.js) + Meta Pixel (fbq)
 * dual-tracker.
 *
 * `window.gtag` is injected by the GoogleAnalytics component in the root
 * layout. If GA is blocked or still loading, every call no-ops gracefully
 * via the `window.gtag?.(...)` optional chain.
 *
 * `window.fbq` is injected by the MetaPixel component in the root layout.
 * Same pattern: `window.fbq?.(...)` — if Meta is blocked / hasn't loaded /
 * user has not consented to marketing cookies, all calls no-op.
 *
 * The legacy `useAnalytics` hook (src/hooks/useAnalytics.ts, retired in
 * refactor/full-repository-consolidation Phase A2) used to consume this
 * module; the public API — `init`, `event`, `productView`, `addToCart`,
 * `removeFromCart`, `checkoutStart`, `purchase`, `search`, `signup`, `error`
 * — is preserved for direct callers.
 *
 * CONVERSION EVENT MAPPING (Meta Pixel standard events):
 *   view_item        → ViewContent
 *   add_to_cart      → AddToCart
 *   remove_from_cart → RemoveFromCart (custom)
 *   begin_checkout   → InitiateCheckout
 *   purchase         → Purchase  ← most important for ad optimization
 *   search           → Search
 *   sign_up          → CompleteRegistration
 *
 * GA4 receives the original event name unchanged so existing dashboards /
 * audiences keep working. Meta gets the equivalent standard event with the
 * same content_ids / value / currency so its optimization algorithms see
 * real conversion data.
 */

type GtagFn = (
  command: "event" | "config" | "set",
  eventName: string,
  params?: Record<string, unknown>,
) => void;

// Meta Pixel signature is intentionally permissive: Meta accepts a wide
// range of commands (track / trackCustom / init / consent / set /
// addPixelId / etc.), and eventName/params shape varies per command.
// We use a function type with `any` parameters so optional-chain calls
// like `window.fbq?.("track", ...)` resolve to the function type rather
// than `never` (which happens with fully-generic `(...args: unknown[])`
// signatures because TS can't bind the optional chain).
type FbqFn = (command: string, eventName?: string, params?: Record<string, unknown>) => void;

declare global {
  interface Window {
    gtag?: GtagFn;
    dataLayer?: unknown[];
    fbq?: FbqFn;
    _fbq?: FbqFn;
    /**
     * Marketing-cookie consent flag set by the consent banner. Read by
     * MetaPixelConsent (to call `fbq('consent', grant|revoke)`) and by
     * the analytics module (to drop fbq calls when consent is denied).
     */
    __META_CONSENT__?: boolean;
  }
}

const CURRENCY = "SAR";

// Endpoint that records events to our own analytics_events ledger. Same
// shape as GA4 events (so a future swap-in of server-side GA4 stays
// trivial), but lives in our DB so we own the retention + join with
// orders/vendors/products. See src/app/api/v1/analytics/event/route.ts.
const IN_HOUSE_ENDPOINT = "/api/v1/analytics/event";

// Allow-list kept in sync with the API route validator. Anything outside
// this set is dropped client-side — the server-side validator does the
// same check, but skipping here saves a network round trip and matches
// the GA4 standard-event set we're actually optimising for.
const IN_HOUSE_ALLOWLIST = new Set<string>([
  "add_to_cart",
  "remove_from_cart",
  "checkout_start",
  "purchase",
  "search",
  "signup",
  "view_item",
  "begin_checkout",
  "share",
  "exception",
]);

// Map a GA4-flavoured payload + camelCase extras onto the flat schema the
// /api/v1/analytics/event route understands:
//   { eventName, vendorId, orderId, productId, revenue, currency, metadata }
// The route validates IDs as UUID-shaped — non-UUID strings are silently
// dropped, but we still include them in `metadata` so they surface in the
// ledger for non-UUID identifiers (vendor slugs, transaction IDs, etc.).
function buildInHouseBody(
  eventName: string,
  params: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const meta: Record<string, unknown> = {};
  const p = params ?? {};

  // Vendor: GA4 prefers snake_case `vendor_id`, the camelCase `vendorId`
  // comes from our own convenience trackers. Pass whichever is present
  // through to the dedicated column; always keep the original in metadata
  // so non-UUID vendor slugs survive.
  const vendorId =
    (typeof p.vendorId === "string" ? p.vendorId : undefined) ??
    (typeof p.vendor_id === "string" ? p.vendor_id : undefined);
  if (vendorId) meta.vendor_id = vendorId;

  // Order: GA4 calls it `transaction_id` for purchase; we also accept
  // `orderId` from our own trackers. Map both to the server column.
  const orderId =
    (typeof p.orderId === "string" ? p.orderId : undefined) ??
    (typeof p.transaction_id === "string" ? p.transaction_id : undefined) ??
    (typeof p.order_id === "string" ? p.order_id : undefined);
  if (orderId) {
    meta.transaction_id = orderId;
    meta.orderId = orderId;
  }

  // Product: GA4 puts this in items[].item_id; convenience trackers pass
  // it as a flat field. Take the first item if an array is present.
  let productId: string | undefined;
  if (Array.isArray(p.items) && p.items.length > 0) {
    const first = p.items[0] as Record<string, unknown> | undefined;
    const candidate =
      (typeof first?.product_id === "string" ? first.product_id : undefined) ??
      (typeof first?.item_id === "string" ? first.item_id : undefined);
    if (candidate) productId = candidate;
  }
  if (!productId && typeof p.product_id === "string") productId = p.product_id;
  if (!productId && typeof p.item_id === "string") productId = p.item_id;
  if (productId) meta.product_id = productId;

  // Revenue: prefer the dedicated `value` field, fall back to revenue.
  let revenue: number | undefined;
  if (typeof p.value === "number" && Number.isFinite(p.value)) revenue = p.value;
  else if (typeof p.revenue === "number" && Number.isFinite(p.revenue)) revenue = p.revenue;

  // Currency is optional — server defaults to SAR.
  const currency =
    typeof p.currency === "string" && p.currency.length > 0 ? p.currency : undefined;

  // Bucket all remaining params under `metadata` so we never lose
  // debuggability. The route caps this at 8KB; anything larger is
  // silently dropped server-side, which is fine for analytics.
  for (const [k, v] of Object.entries(p)) {
    if (
      k === "vendorId" ||
      k === "vendor_id" ||
      k === "orderId" ||
      k === "transaction_id" ||
      k === "order_id" ||
      k === "product_id" ||
      k === "item_id" ||
      k === "value" ||
      k === "revenue" ||
      k === "currency"
    ) {
      continue;
    }
    meta[k] = v;
  }

  const body: Record<string, unknown> = { eventName };
  if (vendorId) body.vendorId = vendorId;
  if (orderId) body.orderId = orderId;
  if (productId) body.productId = productId;
  if (typeof revenue === "number") body.revenue = revenue;
  if (currency) body.currency = currency;
  body.metadata = meta;
  return body;
}

/**
 * Send a single event to the in-house ledger. Uses sendBeacon first
 * (it survives page unloads — critical for purchase events that fire
 * right before navigation to the payment gateway); falls back to
 * fetch with keepalive: true when sendBeacon isn't available or
 * returns false (quota exceeded, payload too large). Never throws.
 */
function sendInHouseEvent(eventName: string, params?: Record<string, unknown>): void {
  if (typeof window === "undefined") return;
  if (!IN_HOUSE_ALLOWLIST.has(eventName)) return;
  if (typeof navigator === "undefined") return;

  let body: string;
  try {
    body = JSON.stringify(buildInHouseBody(eventName, params));
  } catch {
    return;
  }
  const blob = new Blob([body], { type: "application/json" });
  let beaconUrl: string;
  try {
    beaconUrl = new URL(IN_HOUSE_ENDPOINT, window.location.origin).toString();
  } catch {
    beaconUrl = IN_HOUSE_ENDPOINT;
  }

  // sendBeacon returns true when the browser accepts the request for
  // delivery. A false return means the payload was rejected (typically
  // because it's too large) — fall back to fetch with keepalive so we
  // still get the event during page-unload races.
  const beacon = navigator.sendBeacon;
  if (typeof beacon === "function") {
    try {
      if (beacon.call(navigator, beaconUrl, blob)) return;
    } catch {
      // fall through to fetch
    }
  }

  if (typeof fetch === "function") {
    try {
      void fetch(beaconUrl, {
        method: "POST",
        body,
        keepalive: true,
        headers: { "Content-Type": "application/json" },
      });
    } catch {
      // analytics must never break the page
    }
  }
}

function send(command: "event" | "config" | "set", name: string, params?: Record<string, unknown>) {
  if (typeof window === "undefined") return;
  window.gtag?.(command, name, params);
}

/**
 * Send a Meta Pixel standard or custom event. No-ops when:
  //   - SSR (window undefined)
  //   - fbq blocked / blocked by ad-blocker / not yet loaded
  //   - user has not consented to marketing cookies (consent gate below)
 */
function sendMeta(
  eventName: string,
  params?: Record<string, unknown>,
  custom = false,
) {
  if (typeof window === "undefined") return;
  // Respect the consent gate. The layout reads window.__META_CONSENT__ on
  // mount; if the user has explicitly opted out, every fbq call is dropped
  // server-side too (see MetaPixel component). This is a defence-in-depth
  // check — the layout would not have rendered the pixel script if consent
  // was already denied.
  if (window.__META_CONSENT__ === false) return;
  // Hoist the optional function into a local before calling — TS narrows
  // `window.fbq?.(...)` to `never` when the chain subject itself is
  // optional, which kills the call signature. The local-variable form
  // keeps the function type intact.
  const fbq = window.fbq;
  if (!fbq) return;
  if (custom) {
    fbq("trackCustom", eventName, params);
  } else {
    fbq("track", eventName, params);
  }
}

export const analytics = {
  init({ trackingId }: { trackingId: string }) {
    if (typeof window === "undefined") return;
    // Allow build-time / env-var injection of the GA4 measurement id so
    // a deploy can swap ids without touching call sites. Explicit
    // `trackingId` arg wins when both are present.
    const envId =
      typeof process !== "undefined" &&
      process.env &&
      typeof process.env.NEXT_PUBLIC_GA4_ID === "string"
        ? process.env.NEXT_PUBLIC_GA4_ID
        : "";
    const effectiveId = envId || trackingId;
    if (!effectiveId) {
      // Dev-mode reminder; production must stay silent so missing config
      // doesn't leak into user-facing logs.
      if (typeof process !== "undefined" && process.env && process.env.NODE_ENV === "development") {
        // Audit I39: kept as raw `console.warn` because this module is
        // imported by client bundles (no Node `process.env` access at
        // module top level). The surrounding `NODE_ENV === "development"`
        // guard already keeps it silent in production builds, which is
        // the same effective behaviour as the canonical logger's
        // LOG_LEVEL gate.
        // eslint-disable-next-line no-console
        console.warn("[analytics] init() called with no GA4 tracking id; GA events will be dropped.");
      }
      return;
    }
    window.dataLayer = window.dataLayer || [];
    window.gtag = function gtag(...args: Parameters<GtagFn>) {
      (window.dataLayer as unknown[]).push(args);
    };
    send("config", effectiveId);
  },

  /**
   * Grant / revoke Meta Pixel consent at runtime. Called by the consent
   * banner component. When `granted === false`, every subsequent fbq
   * call is dropped client-side. To clear a previously tracked user
   * from Meta's audience, the consent banner should also call the Meta
   * Consent API endpoint (POST /consent/consent) — wiring that lives in
   * the consent banner, not here.
   */
  setMetaConsent(granted: boolean) {
    if (typeof window === "undefined") return;
    window.__META_CONSENT__ = granted;
  },

  event(action: string, params?: Record<string, unknown>) {
    send("event", action, params);
    // Generic events have no Meta standard event equivalent — fire as a
    // custom event so it still shows up in Events Manager's Custom Events
    // section. Naming: keep the GA4 action verbatim for easier triage.
    sendMeta(action, params, true);
    sendInHouseEvent(action, params);
  },

  productView(product: { id: string; name: string; category?: string; price?: number; currency?: string; vendorId?: string }) {
    const ga4Items = [
      {
        item_id: product.id,
        item_name: product.name,
        price: product.price,
        item_category: product.category,
      },
    ];
    send("event", "view_item", {
      currency: CURRENCY,
      value: product.price ?? 0,
      items: ga4Items,
    });
    // Meta ViewContent — content_ids is an ARRAY (Meta convention) so the
    // pixel can dedupe product-level catalog matches.
    sendMeta("ViewContent", {
      content_ids: [product.id],
      content_name: product.name,
      content_category: product.category,
      content_type: "product",
      value: product.price ?? 0,
      currency: CURRENCY,
    });
    // In-house ledger — same view_item name as GA4 so future dashboard
    // joins stay simple. product.vendorId is preserved as metadata even
    // when the server validator rejects it (non-UUID vendor slug).
    sendInHouseEvent("view_item", {
      currency: CURRENCY,
      value: product.price ?? 0,
      items: ga4Items,
      product_id: product.id,
      product_name: product.name,
      product_category: product.category,
      vendorId: product.vendorId,
    });
  },

  addToCart(item: { id: string; name: string; price: number; quantity: number; category?: string; currency?: string; vendorId?: string }) {
    const ga4Items = [
      {
        item_id: item.id,
        item_name: item.name,
        price: item.price,
        quantity: item.quantity,
        item_category: item.category,
      },
    ];
    const value = item.price * item.quantity;
    send("event", "add_to_cart", {
      currency: CURRENCY,
      value,
      items: ga4Items,
    });
    sendMeta("AddToCart", {
      content_ids: [item.id],
      content_name: item.name,
      content_category: item.category,
      content_type: "product",
      value,
      currency: CURRENCY,
      contents: [{ id: item.id, quantity: item.quantity }],
    });
    sendInHouseEvent("add_to_cart", {
      currency: CURRENCY,
      value,
      items: ga4Items,
      product_id: item.id,
      product_name: item.name,
      product_category: item.category,
      vendorId: item.vendorId,
    });
  },

  removeFromCart(item: { id: string; name: string; price: number; quantity: number }) {
    const value = item.price * item.quantity;
    send("event", "remove_from_cart", {
      currency: CURRENCY,
      value,
      items: [
        {
          item_id: item.id,
          item_name: item.name,
          price: item.price,
          quantity: item.quantity,
        },
      ],
    });
    // Meta has no standard remove-from-cart event; fire as custom so the
    // cart-funnel drop-off is still visible in Events Manager.
    sendMeta(
      "RemoveFromCart",
      {
        content_ids: [item.id],
        content_name: item.name,
        value,
        currency: CURRENCY,
        contents: [{ id: item.id, quantity: item.quantity }],
      },
      true,
    );
    sendInHouseEvent("remove_from_cart", {
      currency: CURRENCY,
      value,
      items: [{ item_id: item.id, item_name: item.name }],
      product_id: item.id,
      product_name: item.name,
    });
  },

  checkoutStart(cartValue: number, itemCount: number) {
    send("event", "begin_checkout", {
      currency: CURRENCY,
      value: cartValue,
      items: [{ quantity: itemCount }],
    });
    sendMeta("InitiateCheckout", {
      value: cartValue,
      currency: CURRENCY,
      num_items: itemCount,
      content_type: "product",
    });
    sendInHouseEvent("checkout_start", {
      currency: CURRENCY,
      value: cartValue,
      item_count: itemCount,
    });
  },

  purchase(order: {
    id: string;
    revenue: number;
    tax?: number;
    shipping?: number;
    items: Array<{ id: string; name: string; price: number; quantity: number; category?: string }>;
  }) {
    const ga4Items = order.items.map((i) => ({
      item_id: i.id,
      item_name: i.name,
      price: i.price,
      quantity: i.quantity,
      item_category: i.category,
    }));
    send("event", "purchase", {
      transaction_id: order.id,
      currency: CURRENCY,
      value: order.revenue,
      tax: order.tax,
      shipping: order.shipping,
      items: ga4Items,
    });
    // Meta Purchase — the single most important conversion event for ad
    // optimization. Includes contents[] (Meta array of {id, quantity})
    // so catalog-match attribution works.
    sendMeta("Purchase", {
      value: order.revenue,
      currency: CURRENCY,
      content_ids: order.items.map((i) => i.id),
      content_type: "product",
      num_items: order.items.reduce((n, i) => n + i.quantity, 0),
      contents: order.items.map((i) => ({ id: i.id, quantity: i.quantity })),
      // order_id lets Meta dedupe against server-side CAPI events that
      // the API route may also send (future enhancement).
      order_id: order.id,
    });
    sendInHouseEvent("purchase", {
      transaction_id: order.id,
      currency: CURRENCY,
      value: order.revenue,
      revenue: order.revenue,
      tax: order.tax,
      shipping: order.shipping,
      items: ga4Items,
    });
  },

  search(searchTerm: string, resultCount: number) {
    send("event", "search", { search_term: searchTerm, result_count: resultCount });
    sendMeta("Search", {
      search_string: searchTerm,
      // Meta uses content_category for the facet; we don't have facets here,
      // so leave it out rather than guess.
    });
    sendInHouseEvent("search", {
      search_term: searchTerm,
      result_count: resultCount,
    });
  },

  signup(method: "phone" | "email" | "social") {
    send("event", "sign_up", { method });
    // Meta's standard event for signups. `status` should be `true` on
    // success — we are called only after a successful signup.
    sendMeta("CompleteRegistration", {
      method,
      status: true,
      content_name: "customer_signup",
    });
    sendInHouseEvent("signup", { method });
  },

  error(description: string, fatal = false) {
    send("event", "exception", { description, fatal });
    // No Meta standard event for errors; ship as custom so it surfaces
    // in Events Manager alongside other custom actions.
    sendMeta(
      "SiteError",
      { description, fatal },
      true,
    );
    sendInHouseEvent("exception", { description, fatal });
  },

  /**
   * SPA page-view tracking. Called from the App Router on every route
   * transition; dataLayer carries `page_location`, `page_title`, and
   * any caller-supplied metadata (e.g. logged-in user_id for cohort
   * analysis).
   */
  pageView(pageLocation: string, pageTitle: string, metadata?: Record<string, unknown>) {
    send("event", "page_view", {
      page_location: pageLocation,
      page_title: pageTitle,
      ...(metadata ?? {}),
    });
    // page_view is NOT in the in-house allow-list (we don't need a per-
    // pageview ledger — server access logs already cover this). Skip the
    // in-house send entirely so the route doesn't reject it.
  },

  /**
   * Social-share event. The `target` is the network (`whatsapp`,
   * `twitter`, `copy_link`, etc.); `content` identifies what was shared
   * (`{ type: "product", itemId }` or `{ type: "order", orderId }`).
   */
  share(
    content: { type: string; itemId?: string; orderId?: string; [key: string]: unknown },
    target: string,
  ) {
    send("event", "share", {
      method: target,
      content_type: content.type,
      item_id: content.itemId,
      order_id: content.orderId,
      ...content,
    });
    sendInHouseEvent("share", {
      method: target,
      content_type: content.type,
      item_id: content.itemId,
      orderId: content.orderId,
    });
  },
};