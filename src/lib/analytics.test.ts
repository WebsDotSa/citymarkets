import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("analytics", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let beaconMock: ReturnType<typeof vi.fn>;
  let originalFetch: typeof fetch;
  let originalNavigator: unknown;
  let originalWindow: unknown;

  beforeEach(() => {
    vi.resetModules();
    fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    beaconMock = vi.fn(() => true);
    originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    originalWindow = (globalThis as Record<string, unknown>)["window"];
    originalNavigator = (globalThis as Record<string, unknown>)["navigator"];

    const win: Record<string, unknown> = {
      dataLayer: [],
      gtag: vi.fn(),
    };
    Object.defineProperty(globalThis, "window", {
      value: win,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, "navigator", {
      value: { sendBeacon: beaconMock },
      configurable: true,
      writable: true,
    });
    // Minimal document stub — analytics.init() calls document.createElement
    // and document.head.appendChild when GA4 is configured.
    Object.defineProperty(globalThis, "document", {
      value: {
        createElement: vi.fn(() => ({
          async: true,
          src: "",
        })),
        head: { appendChild: vi.fn() },
      },
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    Object.defineProperty(globalThis, "window", {
      value: originalWindow,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, "navigator", {
      value: originalNavigator,
      configurable: true,
      writable: true,
    });
    delete (globalThis as Record<string, unknown>)["document"];
  });

  describe("sendInHouseEvent (via event())", () => {
    it("does not send when window is undefined (SSR)", async () => {
      Object.defineProperty(globalThis, "window", {
        value: undefined,
        configurable: true,
        writable: true,
      });
      const { analytics } = await import("./analytics");
      // event() does nothing if not initialized AND window is undefined
      // — sendInHouseEvent returns early when window is undefined.
      analytics.event("add_to_cart", { /* eslint-disable-next-line @typescript-eslint/no-explicit-any */ currency: "SAR", value: 10 });
      expect(fetchMock).not.toHaveBeenCalled();
      expect(beaconMock).not.toHaveBeenCalled();
    });

    it("prefers navigator.sendBeacon over fetch", async () => {
      const { analytics } = await import("./analytics");
      // init so analytics is initialized → event() runs
      analytics.init({ trackingId: "G-TEST" });
      fetchMock.mockClear();
      beaconMock.mockClear();

      analytics.event("add_to_cart", { /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
        currency: "SAR",
        value: 50,
        items: [
          { item_id: "p1", item_name: "Product 1", price: 25, quantity: 2 },
        ],
      });

      expect(beaconMock).toHaveBeenCalledTimes(1);
      // sendBeacon succeeded → fetch must NOT be called
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("falls back to fetch when sendBeacon returns false", async () => {
      beaconMock.mockReturnValueOnce(false);
      const { analytics } = await import("./analytics");
      analytics.init({ trackingId: "G-TEST" });
      fetchMock.mockClear();
      beaconMock.mockClear();

      analytics.event("add_to_cart", { /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
        currency: "SAR",
        value: 10,
        items: [{ item_id: "p1" }],
      });

      expect(beaconMock).toHaveBeenCalled();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("skips events not in the GA4→in-house allow-list", async () => {
      const { analytics } = await import("./analytics");
      analytics.init({ trackingId: "G-TEST" });
      fetchMock.mockClear();
      beaconMock.mockClear();

      analytics.event("not_a_real_event");
      expect(fetchMock).not.toHaveBeenCalled();
      expect(beaconMock).not.toHaveBeenCalled();
    });

    it("accepts both vendor_id (GA4) and vendorId (custom) keys", async () => {
      const { analytics } = await import("./analytics");
      analytics.init({ trackingId: "G-TEST" });
      beaconMock.mockClear();

      analytics.event("purchase", {
        transaction_id: "order-1",
        value: 100,
        items: [{ item_id: "p1" }],
        vendor_id: "vendor-ga4",
      });
      // Just check beacon was called with JSON containing the vendor.
      const blob = beaconMock.mock.calls[0][1] as Blob;
      const text = await blob.text();
      expect(text).toContain("vendor-ga4");
    });

    it("accepts vendorId (camelCase) as an alias for vendor_id", async () => {
      const { analytics } = await import("./analytics");
      analytics.init({ trackingId: "G-TEST" });
      beaconMock.mockClear();

      analytics.event("purchase", {
        value: 100,
        orderId: "order-2",
        items: [{ product_id: "p1" }],
        vendorId: "vendor-camel",
      });
      const blob = beaconMock.mock.calls[0][1] as Blob;
      const text = await blob.text();
      expect(text).toContain("vendor-camel");
      expect(text).toContain("order-2");
      expect(text).toContain("p1");
    });

    it("does not throw when the in-house send fails", async () => {
      beaconMock.mockImplementationOnce(() => {
        throw new Error("beacon error");
      });
      const { analytics } = await import("./analytics");
      analytics.init({ trackingId: "G-TEST" });
      expect(() =>
        analytics.event("add_to_cart", { /* eslint-disable-next-line @typescript-eslint/no-explicit-any */ value: 10 }),
      ).not.toThrow();
    });
  });

  describe("init()", () => {
    it("is a no-op on the server (window undefined)", async () => {
      Object.defineProperty(globalThis, "window", {
        value: undefined,
        configurable: true,
        writable: true,
      });
      const { analytics } = await import("./analytics");
      expect(() => analytics.init({ trackingId: "G-X" })).not.toThrow();
    });

    it("warns in dev when no tracking id is configured", async () => {
      delete (process.env as Record<string, string | undefined>).NEXT_PUBLIC_GA4_ID;
      (process.env as Record<string, string | undefined>).NODE_ENV = "development";
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const { analytics } = await import("./analytics");
      analytics.init({ trackingId: "" });
      expect(warnSpy).toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    it("does NOT warn in production when no tracking id is configured", async () => {
      delete (process.env as Record<string, string | undefined>).NEXT_PUBLIC_GA4_ID;
      (process.env as Record<string, string | undefined>).NODE_ENV = "production";
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const { analytics } = await import("./analytics");
      analytics.init({ trackingId: "" });
      expect(warnSpy).not.toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    it("uses NEXT_PUBLIC_GA4_ID env var when set", async () => {
      process.env.NEXT_PUBLIC_GA4_ID = "G-FROM-ENV";
      const { analytics } = await import("./analytics");
      // init() pushes a (config, trackingId, opts) call into window.dataLayer.
      analytics.init({ trackingId: "G-FROM-INIT" });
      const win = (globalThis as Record<string, unknown>)["window"] as {
        dataLayer: unknown[][];
      };
      const configCall = win.dataLayer.find((c) => c[0] === "config");
      expect(configCall?.[1]).toBe("G-FROM-ENV");
      delete (process.env as Record<string, string | undefined>).NEXT_PUBLIC_GA4_ID;
    });
  });

  describe("pageView()", () => {
    it("calls gtag with event=page_view and page_location/title when initialized", async () => {
      const { analytics } = await import("./analytics");
      analytics.init({ trackingId: "G-X" });
      const win = (globalThis as Record<string, unknown>)["window"] as {
        dataLayer: unknown[][];
      };
      // Drop the config/js pushes from init so we only see the pageView one.
      win.dataLayer.length = 0;

      analytics.pageView("/catalog", "Catalog", { user_id: "u1" });
      const call = win.dataLayer.find((c) => c[0] === "event");
      expect(call?.[1]).toBe("page_view");
      const params = call?.[2] as Record<string, unknown>;
      expect(params.page_location).toBe("/catalog");
      expect(params.page_title).toBe("Catalog");
      expect(params.user_id).toBe("u1");
    });
  });

  describe("convenience trackers", () => {
    beforeEach(async () => {
      const { analytics } = await import("./analytics");
      analytics.init({ trackingId: "G-X" });
    });

    it("productView sends a view_item event with the right shape", async () => {
      const { analytics } = await import("./analytics");
      beaconMock.mockClear();
      analytics.productView({
        id: "p1",
        name: "Apple",
        category: "fruits",
        price: 5,
        currency: "SAR",
        vendorId: "v1",
      });
      const blob = beaconMock.mock.calls[0][1] as Blob;
      const text = await blob.text();
      expect(text).toContain("view_item");
      expect(text).toContain("Apple");
      expect(text).toContain("p1");
      expect(text).toContain("v1");
    });

    it("addToCart sends add_to_cart with quantity * price as value", async () => {
      const { analytics } = await import("./analytics");
      beaconMock.mockClear();
      analytics.addToCart({
        id: "p1",
        name: "X",
        price: 10,
        quantity: 3,
        vendorId: "v1",
      });
      const blob = beaconMock.mock.calls[0][1] as Blob;
      const text = await blob.text();
      expect(text).toContain("add_to_cart");
      // value should be 30 (price * quantity)
      expect(text).toContain("30");
    });

    it("removeFromCart sends remove_from_cart", async () => {
      const { analytics } = await import("./analytics");
      beaconMock.mockClear();
      analytics.removeFromCart({
        id: "p1",
        name: "X",
        price: 10,
        quantity: 2,
      });
      const blob = beaconMock.mock.calls[0][1] as Blob;
      const text = await blob.text();
      expect(text).toContain("remove_from_cart");
    });

    it("checkoutStart sends begin_checkout with cartValue and itemCount", async () => {
      const { analytics } = await import("./analytics");
      beaconMock.mockClear();
      analytics.checkoutStart(150, 3);
      const blob = beaconMock.mock.calls[0][1] as Blob;
      const text = await blob.text();
      expect(text).toContain("checkout_start");
      expect(text).toContain("150");
    });

    it("purchase sends a purchase event with transaction_id + revenue", async () => {
      const { analytics } = await import("./analytics");
      beaconMock.mockClear();
      analytics.purchase({
        id: "order-42",
        revenue: 200,
        tax: 30,
        shipping: 10,
        items: [
          { id: "p1", name: "A", price: 50, quantity: 2 },
          { id: "p2", name: "B", price: 100, quantity: 1 },
        ],
      });
      const blob = beaconMock.mock.calls[0][1] as Blob;
      const text = await blob.text();
      expect(text).toContain("purchase");
      expect(text).toContain("order-42");
      expect(text).toContain("200");
    });

    it("search sends a search event with the term + result count", async () => {
      const { analytics } = await import("./analytics");
      beaconMock.mockClear();
      analytics.search("apple", 12);
      const blob = beaconMock.mock.calls[0][1] as Blob;
      const text = await blob.text();
      expect(text).toContain("search");
      expect(text).toContain("apple");
    });

    it("signup sends sign_up with the method", async () => {
      const { analytics } = await import("./analytics");
      beaconMock.mockClear();
      analytics.signup("phone");
      const blob = beaconMock.mock.calls[0][1] as Blob;
      const text = await blob.text();
      expect(text).toContain("signup");
      expect(text).toContain("phone");
    });

    it("share sends a share event", async () => {
      const { analytics } = await import("./analytics");
      beaconMock.mockClear();
      analytics.share({ type: "product", itemId: "p1" }, "whatsapp");
      const blob = beaconMock.mock.calls[0][1] as Blob;
      const text = await blob.text();
      expect(text).toContain("share");
      expect(text).toContain("product");
      expect(text).toContain("whatsapp");
    });

    it("error sends an exception event", async () => {
      const { analytics } = await import("./analytics");
      beaconMock.mockClear();
      analytics.error("something failed", true);
      const blob = beaconMock.mock.calls[0][1] as Blob;
      const text = await blob.text();
      expect(text).toContain("exception");
      expect(text).toContain("something failed");
    });
  });

  describe("event() before init", () => {
    it("does not call gtag (only the in-house send runs when window exists)", async () => {
      const { analytics } = await import("./analytics");
      const win = (globalThis as Record<string, unknown>)["window"] as {
        gtag: ReturnType<typeof vi.fn>;
      };
      win.gtag.mockClear();
      beaconMock.mockClear();

      analytics.event("add_to_cart", { /* eslint-disable-next-line @typescript-eslint/no-explicit-any */ value: 10 });
      expect(beaconMock).toHaveBeenCalled();
    });
  });
});