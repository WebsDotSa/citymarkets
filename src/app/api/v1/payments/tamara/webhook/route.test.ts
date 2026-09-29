/**
 * Regression tests for POST /api/v1/payments/tamara/webhook.
 *
 * Invariants under test (mirrors src/app/api/v1/payments/webhook/route.test.ts
 * for the Moyasar path — both gateways must agree on outcomes):
 *   1. Auth — rejects when TAMARA_WEBHOOK_TOKEN unset (401)
 *   2. Auth — rejects when Authorization header missing/wrong (401)
 *   3. tamara.approved → orders.status + vendor_orders.status = 'confirmed'
 *      (NEVER 'paid'; Bug A parity with Moyasar webhook)
 *   4. recordPaymentEvent called FIRST with gateway='tamara'
 *   5. Duplicate replay → {received:true, duplicate:true} via UNIQUE index
 *   6. Currency mismatch (KWD) → ack 200 but skip loyalty credit
 *   7. finalizePaymentEvent runs after COMMIT
 *   8. Gap D closure — paid → enqueue NOTIFY_VENDOR_NEW_ORDER for every
 *      child vendor (multi-vendor fan-out)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  pool: {
    connect: vi.fn(),
    query: vi.fn(async () => ({ rows: [] })),
  },
}));
vi.mock("@/lib/payments/tamara", () => ({
  fetchOrderStatus: vi.fn(),
  getTamaraWebhookToken: vi.fn(() => "tamara-secret"),
  verifyWebhookSignature: vi.fn(() => true),
}));
vi.mock("@/lib/payments/event-ledger", () => ({
  recordPaymentEvent: vi.fn(async () => "inserted"),
  finalizePaymentEvent: vi.fn(),
}));
vi.mock("@/lib/orders/loyalty", () => ({
  awardPointsForOrder: vi.fn(),
  getLoyaltySettings: vi.fn(),
  resolveRedeemForOrder: vi.fn(),
}));
vi.mock("@/lib/push", () => ({
  sendPushToUser: vi.fn(),
}));
vi.mock("@/lib/queue", () => ({
  enqueueNotifyVendorNewOrder: vi.fn(),
  enqueueOrderPaidSms: vi.fn(),
}));
vi.mock("@/lib/orders/abandoned-carts", () => ({
  markAbandonedCartRecovered: vi.fn(async () => ({ recovered_count: 0 })),
}));
vi.mock("@/lib/logger", () => ({
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
}));

import { pool } from "@/lib/db";
import {
  fetchOrderStatus,
  getTamaraWebhookToken,
  verifyWebhookSignature,
} from "@/lib/payments/tamara";
import { recordPaymentEvent, finalizePaymentEvent } from "@/lib/payments/event-ledger";
import { enqueueNotifyVendorNewOrder } from "@/lib/queue";
import { POST } from "./route";

const PARENT_ORDER = {
  id: "00000000-0000-0000-0000-0000000000bb",
  total: "200.00",
  catalog_subtotal: "180.00",
  user_id: null,
  points_redeemed: "0",
  payment_status: "pending",
  status: "pending",
  guest_phone: null,
  guest_name: null,
};

const CHECKOUT_ID = "co_tamara_1";

type SqlCall = { sql: string; params: unknown[] };

function makeFakeClient(opts: {
  vendorIds?: string[];
  paymentEventResult?: "inserted" | "duplicate";
}) {
  const calls: SqlCall[] = [];
  const client = {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      const s = sql.trim().toUpperCase();
      if (s.startsWith("BEGIN") || s.startsWith("COMMIT") || s.startsWith("ROLLBACK"))
        return { rows: [] };
      if (s.startsWith("INSERT INTO PAYMENT_EVENTS")) {
        if (opts.paymentEventResult === "duplicate") {
          const err = new Error("duplicate") as Error & { code?: string };
          err.code = "23505";
          throw err;
        }
        return { rows: [] };
      }
      if (s.startsWith("UPDATE PAYMENT_EVENTS")) return { rows: [] };
      if (s.startsWith("SELECT PG_ADVISORY_XACT_LOCK")) return { rows: [] };
      if (s.startsWith("UPDATE")) return { rows: [] };
      return { rows: [] };
    }),
    release: vi.fn(),
  };
  return { client, calls };
}

function signedRequest(body: unknown, token = "tamara-secret") {
  return new Request("http://localhost/api/v1/payments/tamara/webhook", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
}

const PAID_BODY = {
  order_id: PARENT_ORDER.id,
  order_status: "approved",
  tamara_order_id: CHECKOUT_ID,
};

describe("POST /api/v1/payments/tamara/webhook — auth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects with 401 when TAMARA_WEBHOOK_TOKEN is unset", async () => {
    vi.mocked(getTamaraWebhookToken).mockReturnValueOnce("");
    const res = await POST(signedRequest(PAID_BODY) as never);
    expect(res.status).toBe(401);
  });

  it("rejects with 401 when Authorization header is missing", async () => {
    vi.mocked(verifyWebhookSignature).mockReturnValueOnce(false);
    const req = new Request("http://localhost/api/v1/payments/tamara/webhook", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(PAID_BODY),
    });
    const res = await POST(req as never);
    expect(res.status).toBe(401);
  });

  it("accepts signed request with 200", async () => {
    const { client } = makeFakeClient({ paymentEventResult: "inserted" });
    vi.mocked(pool.connect).mockResolvedValueOnce(client as never);
    vi.mocked(pool.query)
      // 1st call: SELECT FROM orders WHERE payment_reference
      .mockResolvedValueOnce({ rows: [PARENT_ORDER] } as never)
      // vendor fan-out
      .mockResolvedValueOnce({ rows: [{ vendor_id: "vendor-1" }] } as never);
    vi.mocked(fetchOrderStatus).mockResolvedValueOnce({
      success: true,
      status: "approved",
      amount: 20000,
      currency: "SAR",
    });
    vi.mocked(recordPaymentEvent).mockResolvedValueOnce("inserted");

    const res = await POST(signedRequest(PAID_BODY) as never);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({ received: true });
  });
});

describe("POST /api/v1/payments/tamara/webhook — Bug A parity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("approved → vendor_orders.status='confirmed' (NEVER 'paid')", async () => {
    const { client, calls } = makeFakeClient({ paymentEventResult: "inserted" });
    vi.mocked(pool.connect).mockResolvedValueOnce(client as never);
    vi.mocked(pool.query)
      .mockResolvedValueOnce({ rows: [PARENT_ORDER] } as never)
      .mockResolvedValueOnce({ rows: [{ vendor_id: "vendor-1" }] } as never);
    vi.mocked(fetchOrderStatus).mockResolvedValueOnce({
      success: true,
      status: "approved",
      amount: 20000,
      currency: "SAR",
    });
    vi.mocked(recordPaymentEvent).mockResolvedValueOnce("inserted");

    await POST(signedRequest(PAID_BODY) as never);

    const vendorStatus = calls.find(
      (c) =>
        c.sql.trim().toUpperCase().startsWith("UPDATE VENDOR_ORDERS") &&
        /SET\s+STATUS/i.test(c.sql),
    );
    expect(vendorStatus).toBeDefined();
    expect(vendorStatus!.sql).toMatch(/CASE/i);
    expect(JSON.stringify(vendorStatus!.params)).not.toMatch(/\"paid\"/);
  });

  it("approved → vendor_orders.payment_status mirrored to 'paid'", async () => {
    const { client, calls } = makeFakeClient({ paymentEventResult: "inserted" });
    vi.mocked(pool.connect).mockResolvedValueOnce(client as never);
    vi.mocked(pool.query)
      .mockResolvedValueOnce({ rows: [PARENT_ORDER] } as never)
      .mockResolvedValueOnce({ rows: [{ vendor_id: "vendor-1" }] } as never);
    vi.mocked(fetchOrderStatus).mockResolvedValueOnce({
      success: true,
      status: "approved",
      amount: 20000,
      currency: "SAR",
    });
    vi.mocked(recordPaymentEvent).mockResolvedValueOnce("inserted");

    await POST(signedRequest(PAID_BODY) as never);

    const mirror = calls.find(
      (c) =>
        c.sql.trim().toUpperCase().startsWith("UPDATE VENDOR_ORDERS") &&
        /PAYMENT_STATUS/i.test(c.sql),
    );
    expect(mirror).toBeDefined();
    expect(mirror!.params[0]).toBe("paid");
  });
});

describe("POST /api/v1/payments/tamara/webhook — ledger + replay", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls recordPaymentEvent with gateway='tamara'", async () => {
    const { client } = makeFakeClient({ paymentEventResult: "inserted" });
    vi.mocked(pool.connect).mockResolvedValueOnce(client as never);
    vi.mocked(pool.query)
      .mockResolvedValueOnce({ rows: [PARENT_ORDER] } as never)
      .mockResolvedValueOnce({ rows: [{ vendor_id: "vendor-1" }] } as never);
    vi.mocked(fetchOrderStatus).mockResolvedValueOnce({
      success: true,
      status: "approved",
      amount: 20000,
      currency: "SAR",
    });
    vi.mocked(recordPaymentEvent).mockResolvedValueOnce("inserted");

    await POST(signedRequest(PAID_BODY) as never);

    expect(vi.mocked(recordPaymentEvent)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(recordPaymentEvent).mock.calls[0][1]).toMatchObject({
      invoiceId: CHECKOUT_ID,
      gateway: "tamara",
    });
  });

  it("duplicate replay short-circuits with {duplicate:true}", async () => {
    const { client } = makeFakeClient({ paymentEventResult: "duplicate" });
    vi.mocked(pool.connect).mockResolvedValueOnce(client as never);
    vi.mocked(pool.query)
      .mockResolvedValueOnce({ rows: [PARENT_ORDER] } as never);
    vi.mocked(fetchOrderStatus).mockResolvedValueOnce({
      success: true,
      status: "approved",
      amount: 20000,
      currency: "SAR",
    });
    vi.mocked(recordPaymentEvent).mockResolvedValueOnce("duplicate");

    const res = await POST(signedRequest(PAID_BODY) as never);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({ received: true, duplicate: true });
    // No vendor fan-out on replay
    expect(vi.mocked(enqueueNotifyVendorNewOrder)).not.toHaveBeenCalled();
    // FIX (P1-5): duplicate replay still finalizes the ledger row so
    // subsequent replays don't see status='received' forever.
    expect(vi.mocked(finalizePaymentEvent)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(finalizePaymentEvent).mock.calls[0][1]).toMatchObject({
      status: "processed",
    });
  });

  it("finalizePaymentEvent runs after COMMIT", async () => {
    const { client } = makeFakeClient({ paymentEventResult: "inserted" });
    vi.mocked(pool.connect).mockResolvedValueOnce(client as never);
    vi.mocked(pool.query)
      .mockResolvedValueOnce({ rows: [PARENT_ORDER] } as never)
      .mockResolvedValueOnce({ rows: [{ vendor_id: "vendor-1" }] } as never);
    vi.mocked(fetchOrderStatus).mockResolvedValueOnce({
      success: true,
      status: "approved",
      amount: 20000,
      currency: "SAR",
    });
    vi.mocked(recordPaymentEvent).mockResolvedValueOnce("inserted");

    await POST(signedRequest(PAID_BODY) as never);

    expect(vi.mocked(finalizePaymentEvent)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(finalizePaymentEvent).mock.calls[0][1]).toMatchObject({
      invoiceId: CHECKOUT_ID,
      gateway: "tamara",
      status: "processed",
      orderId: PARENT_ORDER.id,
    });
  });
});

describe("POST /api/v1/payments/tamara/webhook — Gap D closure", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("approved → enqueue NOTIFY_VENDOR_NEW_ORDER for every child vendor", async () => {
    const { client } = makeFakeClient({ paymentEventResult: "inserted" });
    vi.mocked(pool.connect).mockResolvedValueOnce(client as never);
    vi.mocked(pool.query)
      .mockResolvedValueOnce({ rows: [PARENT_ORDER] } as never)
      .mockResolvedValueOnce({
        rows: [
          { vendor_id: "vendor-1" },
          { vendor_id: "vendor-2" },
          { vendor_id: "vendor-3" },
        ],
      } as never);
    vi.mocked(fetchOrderStatus).mockResolvedValueOnce({
      success: true,
      status: "approved",
      amount: 20000,
      currency: "SAR",
    });
    vi.mocked(recordPaymentEvent).mockResolvedValueOnce("inserted");

    await POST(signedRequest(PAID_BODY) as never);

    expect(vi.mocked(enqueueNotifyVendorNewOrder)).toHaveBeenCalledTimes(3);
    expect(vi.mocked(enqueueNotifyVendorNewOrder).mock.calls[0][0]).toEqual({
      vendorId: "vendor-1",
      orderId: PARENT_ORDER.id,
    });
  });

  it("declined → does NOT enqueue vendor notification", async () => {
    const { client } = makeFakeClient({ paymentEventResult: "inserted" });
    vi.mocked(pool.connect).mockResolvedValueOnce(client as never);
    vi.mocked(pool.query).mockResolvedValueOnce({
      rows: [{ ...PARENT_ORDER, payment_status: "failed" }],
    } as never);
    vi.mocked(fetchOrderStatus).mockResolvedValueOnce({
      success: true,
      status: "declined",
      amount: 20000,
      currency: "SAR",
    });
    vi.mocked(recordPaymentEvent).mockResolvedValueOnce("inserted");

    await POST(
      signedRequest({ ...PAID_BODY, order_status: "declined" }) as never,
    );

    expect(vi.mocked(enqueueNotifyVendorNewOrder)).not.toHaveBeenCalled();
  });
});

describe("POST /api/v1/payments/tamara/webhook — currency guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("non-SAR currency rejects loyalty credit (still 200)", async () => {
    const { client } = makeFakeClient({ paymentEventResult: "inserted" });
    vi.mocked(pool.connect).mockResolvedValueOnce(client as never);
    vi.mocked(pool.query)
      .mockResolvedValueOnce({ rows: [PARENT_ORDER] } as never)
      .mockResolvedValueOnce({ rows: [{ vendor_id: "vendor-1" }] } as never);
    vi.mocked(fetchOrderStatus).mockResolvedValueOnce({
      success: true,
      status: "approved",
      amount: 20000,
      currency: "KWD",
    });
    vi.mocked(recordPaymentEvent).mockResolvedValueOnce("inserted");

    const res = await POST(signedRequest(PAID_BODY) as never);
    expect(res.status).toBe(200);
  });

  it("missing tamara_order_id returns 200 received (Tamara does not retry)", async () => {
    vi.mocked(fetchOrderStatus).mockResolvedValueOnce({
      success: true,
      status: "approved",
    });
    const res = await POST(
      signedRequest({ order_id: PARENT_ORDER.id, order_status: "approved" }) as never,
    );
    expect(res.status).toBe(200);
  });

  it("order not found returns 200 received", async () => {
    vi.mocked(fetchOrderStatus).mockResolvedValueOnce({
      success: true,
      status: "approved",
      amount: 20000,
      currency: "SAR",
    });
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [] } as never);

    const res = await POST(signedRequest(PAID_BODY) as never);
    expect(res.status).toBe(200);
  });
});