/**
 * Regression test for PCP-135:
 *
 *   `runCheckout` must canonicalise legacy payment-method tokens
 *   (`cash`, `card`, `moyasar`, `tamara`, `stc_pay`, `cod`,
 *   `cash_on_delivery`, `applepay` typo, `master_card` typo) into
 *   their canonical `PaymentMethodId` BEFORE the parent INSERT writes
 *   `orders.payment_method`. Previously the route cast the raw string
 *   and stored it verbatim — every legacy-token order was counted as
 *   non-electronic in analytics, even when the underlying charge was a
 *   Moyasar card.
 *
 * The cleanest way to assert the fix without spinning up Postgres is
 * to call the inner `createCheckout` indirectly via `runCheckout` and
 * capture the `paymentMethod` arg fed to it. We mock every heavy
 * dependency (`pool`, `getStoreStatusSettings`, etc.) so the only
 * real code that runs is the zod validation + the legacy-token
 * canonicalisation at line ~320.
 *
 * What this test asserts:
 *   1. `paymentMethod: 'cash'` is canonicalised to `'wallet'`
 *   2. `paymentMethod: 'moyasar'` is canonicalised to `'mada'`
 *   3. `paymentMethod: 'tamara'` is canonicalised to `'bank_transfer'`
 *   4. `paymentMethod: 'applepay'` (typo) is canonicalised to `'apple_pay'`
 *   5. An unknown token throws via `resolvePaymentMethod`
 *   6. A canonical token passes through unchanged
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the heavy deps BEFORE importing the service
vi.mock("@/lib/db", () => {
  const client = {
    query: vi.fn().mockImplementation(async (sql: string) => {
      const norm = sql.trim().toUpperCase();
      if (norm === "BEGIN") return { rows: [], rowCount: 0 };
      if (norm === "COMMIT") return { rows: [], rowCount: 0 };
      if (norm === "ROLLBACK") return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 0 };
    }),
    release: vi.fn(),
  };
  return {
    pool: {
      connect: vi.fn().mockResolvedValue(client),
      query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    },
  };
});

vi.mock("@/lib/validation", () => ({
  multiVendorCheckoutSchema: {
    safeParse: vi.fn().mockImplementation((body: unknown) => ({
      success: true,
      data: body,
    })),
  },
}));

vi.mock("@/lib/app-settings", () => ({
  getStoreStatusSettings: vi.fn().mockResolvedValue({ is_open: true }),
}));

vi.mock("@/lib/delivery/delivery-hours", () => ({
  evaluateHours: vi.fn().mockReturnValue({ open: true }),
}));

vi.mock("@/lib/delivery/store-hours", () => ({
  getActiveStoreHours: vi.fn().mockResolvedValue({
    open_time: "00:00",
    close_time: "23:59",
  }),
}));

vi.mock("@/lib/delivery/vendor-closed-gate", () => ({
  checkClosedVendorsInCart: vi
    .fn()
    .mockResolvedValue({ closed: [], message: "" }),
}));

vi.mock("@/lib/delivery/main-store", () => ({
  getMainStoreAndDistance: vi.fn().mockResolvedValue({
    store: { id: "main-store-id", lat: 24.7, lng: 46.7 },
    distanceKm: null,
  }),
}));

vi.mock("@/lib/orders/loyalty", () => ({
  getLoyaltySettings: vi.fn().mockResolvedValue({
    redeem_value_per_point: 0.05,
    max_redeem_percent: 0.5,
  }),
}));

vi.mock("@/lib/orders/checkout/create-checkout", () => ({
  createCheckout: vi.fn().mockImplementation(async (args) => {
    // Capture the canonical payment_method that the service passed.
    captured.push(args.input.paymentMethod);
    // Simulate a no-op checkout success — the test only cares about
    // what paymentMethod was forwarded.
    return {
      success: true,
      parentOrderId: "p",
      vendorOrderIds: [],
      totals: {
        catalogSubtotal: 0,
        vendorSubtotals: {},
        catalogDeliveryFee: 0,
        vendorDeliveryFees: {},
        totalDeliveryFee: 0,
        serviceFee: 0,
        discount: 0,
        couponDiscount: 0,
        pointsDiscount: 0,
        pointsRedeemed: 0,
        total: 0,
        vendorTotals: {},
        catalogTotal: 0,
        distanceKm: null,
      },
      paymentMethod: args.input.paymentMethod,
      paymentStatus: "pending",
      requiresOnlinePayment: true,
      couponCode: null,
      duplicate: false,
    };
  }),
}));

vi.mock("@/lib/errors/checkout-error-reporter", () => ({
  reportCheckoutError: vi.fn(),
}));

vi.mock("@/lib/payments/payment-service", () => ({
  markOrderPaymentFailed: vi.fn(),
}));

vi.mock("@/lib/payments/initiate", () => ({
  initiateOnlinePayment: vi.fn(),
  initiateTamaraPayment: vi.fn(),
  isTamaraEnabled: vi.fn().mockReturnValue(false),
  getPaymentProvider: vi.fn().mockReturnValue("moyasar"),
  isMoyasarInlineCheckoutEnabled: vi.fn().mockReturnValue(false),
}));

vi.mock("@/lib/logger", () => ({
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
}));

// Import AFTER mocks are wired
import { runCheckout } from "./checkout-service";

const captured: string[] = [];

function makeBody(token: string): Record<string, unknown> {
  return {
    items: [],
    vendor_groups: [],
    paymentMethod: token,
    idempotency_key: "test-idem-key-12345",
  };
}

describe("runCheckout — PCP-135 legacy payment_method canonicalisation", () => {
  beforeEach(() => {
    captured.length = 0;
  });

  // Note: in these tests we only assert the canonical paymentMethod
  // forwarded to createCheckout. The downstream payment-init step is
  // not mocked cleanly so its return kind is unpredictable, but the
  // createCheckout argument is captured BEFORE payment-init runs, so
  // the canonicalisation assertion is unaffected.

  it("canonicalises `cash` → `wallet`", async () => {
    await runCheckout({
      caller: { userId: "u-1", sessionId: null, clientIp: "1.2.3.4" },
      body: makeBody("cash"),
    });
    expect(captured).toEqual(["wallet"]);
  });

  it("canonicalises `moyasar` → `mada`", async () => {
    await runCheckout({
      caller: { userId: "u-1", sessionId: null, clientIp: "1.2.3.4" },
      body: makeBody("moyasar"),
    });
    expect(captured).toEqual(["mada"]);
  });

  it("canonicalises `tamara` → `bank_transfer`", async () => {
    await runCheckout({
      caller: { userId: "u-1", sessionId: null, clientIp: "1.2.3.4" },
      body: makeBody("tamara"),
    });
    expect(captured).toEqual(["bank_transfer"]);
  });

  it("canonicalises typo `applepay` → `apple_pay`", async () => {
    await runCheckout({
      caller: { userId: "u-1", sessionId: null, clientIp: "1.2.3.4" },
      body: makeBody("applepay"),
    });
    expect(captured).toEqual(["apple_pay"]);
  });

  it("canonicalises `cod` → `wallet`", async () => {
    await runCheckout({
      caller: { userId: "u-1", sessionId: null, clientIp: "1.2.3.4" },
      body: makeBody("cod"),
    });
    expect(captured).toEqual(["wallet"]);
  });

  it("passes canonical tokens through unchanged", async () => {
    await runCheckout({
      caller: { userId: "u-1", sessionId: null, clientIp: "1.2.3.4" },
      body: makeBody("visa"),
    });
    expect(captured).toEqual(["visa"]);
  });

  it("rejects unknown tokens (throws so the caller surfaces a 500)", async () => {
    // resolvePaymentMethod throws on unknown tokens. The service
    // catches it inside the big try/catch and returns internal_error.
    const result = await runCheckout({
      caller: { userId: "u-1", sessionId: null, clientIp: "1.2.3.4" },
      body: makeBody("bitcoin"),
    });
    expect(result.kind).toBe("internal_error");
  });
});