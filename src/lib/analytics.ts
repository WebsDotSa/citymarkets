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
 * The legacy `useAnalytics` hook (src/hooks/useAnalytics.ts) consumes this
 * module, so its public API — `init`, `event`, `productView`, `addToCart`,
 * `removeFromCart`, `checkoutStart`, `purchase`, `search`, `signup`, `error`
 * — is preserved.
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
    if (!trackingId || typeof window === "undefined") return;
    window.dataLayer = window.dataLayer || [];
    window.gtag = function gtag(...args: Parameters<GtagFn>) {
      (window.dataLayer as unknown[]).push(args);
    };
    send("config", trackingId);
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
    send("event", "add_to_cart", {
      currency: CURRENCY,
      value: item.price * item.quantity,
      items: ga4Items,
    });
    sendMeta("AddToCart", {
      content_ids: [item.id],
      content_name: item.name,
      content_category: item.category,
      content_type: "product",
      value: item.price * item.quantity,
      currency: CURRENCY,
      contents: [{ id: item.id, quantity: item.quantity }],
    });
  },

  removeFromCart(item: { id: string; name: string; price: number; quantity: number }) {
    send("event", "remove_from_cart", {
      currency: CURRENCY,
      value: item.price * item.quantity,
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
        value: item.price * item.quantity,
        currency: CURRENCY,
        contents: [{ id: item.id, quantity: item.quantity }],
      },
      true,
    );
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
  },

  search(searchTerm: string, resultCount: number) {
    send("event", "search", { search_term: searchTerm, result_count: resultCount });
    sendMeta("Search", {
      search_string: searchTerm,
      // Meta uses content_category for the facet; we don't have facets here,
      // so leave it out rather than guess.
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
  },
};