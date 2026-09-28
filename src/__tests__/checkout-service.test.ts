import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Smoke tests for CheckoutService — focused on the deterministic,
 * no-DB paths. Heavier integration coverage stays in
 * src/app/api/v1/checkout/route.test.ts (existing) and
 * src/lib/checkout/create-checkout.test.ts.
 *
 * The mocks below stub the lib side-effects so the service can run
 * without a live Postgres pool / payment gateway / push service.
 */

// Mock all the side-effecting imports BEFORE importing the service.
vi.mock("@/lib/db", () => ({
  pool: {
    query: vi.fn(async () => ({ rows: [] })),
    connect: vi.fn(async () => ({
      query: vi.fn(async () => ({ rows: [] })),
      release: vi.fn(),
    })),
  },
}));

vi.mock("@/lib/app-settings", () => ({
  getStoreStatusSettings: vi.fn(async () => ({ is_open: true, message: null })),
}));

vi.mock("@/lib/delivery-hours", () => ({
  getDeliveryHours: vi.fn(async () => ({
    open_time: "08:00",
    close_time: "23:00",
    closed_message: null,
  })),
  evaluateHours: vi.fn(() => ({ open: true, message: null })),
}));

vi.mock("@/lib/vendor-closed-gate", () => ({
  checkClosedVendorsInCart: vi.fn(async () => ({ closed: [], message: null })),
}));

vi.mock("@/lib/loyalty", () => ({
  getLoyaltySettings: vi.fn(async () => ({
    redeem_value_per_point: 0.05,
    max_redeem_percent: 50,
  })),
}));

vi.mock("@/lib/checkout/create-checkout", () => ({
  createCheckout: vi.fn(async () => ({
    success: true,
    parentOrderId: "p1",
    vendorOrderIds: ["v1"],
    duplicate: false,
    requiresOnlinePayment: false,
    paymentMethod: "cash",
    totals: {
      catalogSubtotal: 10,
      vendorSubtotals: {},
      catalogDeliveryFee: 3,
      vendorDeliveryFees: {},
      totalDeliveryFee: 3,
      serviceFee: 0,
      discount: 0,
      couponDiscount: 0,
      pointsDiscount: 0,
      pointsRedeemed: 0,
      total: 13,
      vendorTotals: {},
      catalogTotal: 13,
      distanceKm: 1,
    },
  })),
}));

vi.mock("@/lib/errors/checkout-error-reporter", () => ({
  reportCheckoutError: vi.fn(async () => {}),
}));

vi.mock("@/lib/payments/initiate", () => ({
  initiateOnlinePayment: vi.fn(async () => ({ success: true, paymentUrl: null, referenceId: null })),
  initiateTamaraPayment: vi.fn(async () => ({ success: true, paymentUrl: null, referenceId: null })),
  isMoyasarInlineCheckoutEnabled: vi.fn(() => false),
  isTamaraEnabled: vi.fn(() => false),
  getPaymentProvider: vi.fn(() => "moyasar"),
}));

vi.mock("@/lib/push", () => ({
  sendPushToUser: vi.fn(async () => undefined),
}));

vi.mock("@/lib/order-notify-admin", () => ({
  notifyAdminNewOrder: vi.fn(async () => undefined),
}));

import { runCheckout } from "@/lib/checkout/checkout-service";
import { getStoreStatusSettings } from "@/lib/app-settings";
import { evaluateHours, getDeliveryHours } from "@/lib/delivery-hours";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("CheckoutService — store open/closed gate", () => {
  it("returns store_closed when admin has closed the platform", async () => {
    (getStoreStatusSettings as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      is_open: false,
      message: "إغلاق طارئ",
    });
    const r = await runCheckout({
      caller: { userId: "u1", sessionId: null, clientIp: "1.2.3.4" },
      body: {
        items: [{ product_id: "00000000-0000-0000-0000-000000000001", quantity: 1 }],
        vendor_groups: [],
        idempotency_key: "k-idem-1234567890",
      },
    });
    expect(r.kind).toBe("store_closed");
    if (r.kind === "store_closed") {
      expect(r.status).toBe(503);
      expect(r.error).toBe("إغلاق طارئ");
    }
  });
});

describe("CheckoutService — hours gate", () => {
  it("returns store_closed with outOfHours when evaluateHours says closed", async () => {
    (evaluateHours as ReturnType<typeof vi.fn>).mockReturnValueOnce({
      open: false,
      message: "مغلق الآن",
    });
    (getDeliveryHours as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      open_time: "08:00",
      close_time: "23:00",
      closed_message: null,
    });
    const r = await runCheckout({
      caller: { userId: "u1", sessionId: null, clientIp: "1.2.3.4" },
      body: {
        items: [{ product_id: "00000000-0000-0000-0000-000000000001", quantity: 1 }],
        vendor_groups: [],
        idempotency_key: "k-idem-1234567890",
      },
    });
    expect(r.kind).toBe("store_closed");
    if (r.kind === "store_closed") {
      expect(r.outOfHours).toBe(true);
      expect(r.hours?.open_time).toBe("08:00");
    }
  });
});

describe("CheckoutService — body validation", () => {
  it("returns validation_error on malformed body", async () => {
    const r = await runCheckout({
      caller: { userId: "u1", sessionId: null, clientIp: "1.2.3.4" },
      body: { wrongField: "yes" },
    });
    expect(r.kind).toBe("validation_error");
    if (r.kind === "validation_error") expect(r.status).toBe(400);
  });
});

describe("CheckoutService — scheduled delivery", () => {
  it("rejects scheduled + pickup combination", async () => {
    const r = await runCheckout({
      caller: { userId: "u1", sessionId: null, clientIp: "1.2.3.4" },
      body: {
        items: [{ product_id: "00000000-0000-0000-0000-000000000001", quantity: 1 }],
        vendor_groups: [],
        scheduled: true,
        scheduled_for: "2026-10-01T10:00:00Z",
        slot_id: "slot-abc",
        deliveryType: "pickup",
        idempotency_key: "k-idem-1234567890",
      },
    });
    expect(r.kind).toBe("validation_error");
    if (r.kind === "validation_error") {
      expect(r.error).toMatch(/الاستلام من الفرع لا يدعم الجدولة/);
    }
  });

  it("rejects scheduled without slot_id", async () => {
    const r = await runCheckout({
      caller: { userId: "u1", sessionId: null, clientIp: "1.2.3.4" },
      body: {
        items: [{ product_id: "00000000-0000-0000-0000-000000000001", quantity: 1 }],
        vendor_groups: [],
        scheduled: true,
        scheduled_for: "2026-10-01T10:00:00Z",
        idempotency_key: "k-idem-1234567890",
      },
    });
    expect(r.kind).toBe("validation_error");
  });
});
