/**
 * Regression tests for POST /api/v1/payments/webhook (canonical Moyasar).
 *
 * Invariants under test (each is a known production-critical contract):
 *   1. HMAC auth — unsigned requests are 401; signed requests are 200
 *      (or 200 + {received:true, duplicate:true} on replay).
 *   2. Bug A regression — payment_status='paid' sets
 *      orders.status='confirmed' and vendor_orders.status='confirmed'
 *      (NEVER 'paid'). Paid is a payment_status only.
 *   3. recordPaymentEvent is called FIRST in the transaction, with
 *      gateway='moyasar'. A duplicate replay short-circuits on the
 *      UNIQUE (invoice_id, gateway, event_type) index.
 *   4. Currency / amount mismatch — refuse to credit loyalty but
 *      still ack (gateway must not retry forever).
 *   5. Vendor notification fan-out — on paid, every child vendor_order
 *      enqueues a NOTIFY_VENDOR_NEW_ORDER job (Gap D closure).
 *   6. finalizePaymentEvent runs after COMMIT.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

type SqlCall = { sql: string; params: unknown[] };

function makeFakeClient(opts: {
  // The first SELECT returns the parent order. After that we ignore
  // most rows — the test asserts only on the SQL strings.
  order?: {
    id: string;
    payment_reference: string;
    total: number;
    catalog_subtotal: number;
    points_redeemed: number;
    payment_status: string;
    status: string;
    user_id: string | null;
    guest_phone: string | null;
    guest_name: string | null;
  };
  // First INSERT into payment_events returns ok; second call returns
  // 23505 unique_violation when the test wants to simulate a replay.
  paymentEventResult?: "inserted" | "duplicate";
  // vendor_orders for the fan-out notification step.
  vendorIds?: string[];
}) {
  const calls: SqlCall[] = [];
  const client = {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      const s = sql.trim().toUpperCase();

      // BEGIN / COMMIT / ROLLBACK — always succeed
      if (s.startsWith("BEGIN")) return { rows: [] };
      if (s.startsWith("COMMIT")) return { rows: [] };
      if (s.startsWith("ROLLBACK")) return { rows: [] };

      // recordPaymentEvent — first INSERT INTO payment_events
      if (s.startsWith("INSERT INTO PAYMENT_EVENTS")) {
        if (opts.paymentEventResult === "duplicate") {
          const err = new Error("duplicate") as Error & { code?: string };
          err.code = "23505";
          throw err;
        }
        return { rows: [] };
      }

      // finalizePaymentEvent — UPDATE payment_events ... SET status
      if (
        s.startsWith("UPDATE PAYMENT_EVENTS") &&
        /SET\s+STATUS/i.test(s)
      ) {
        return { rows: [] };
      }

      // SELECT ... FROM orders WHERE payment_reference = $1
      if (
        s.startsWith("SELECT") &&
        /FROM\s+ORDERS\b/.test(s) &&
        opts.order
      ) {
        return { rows: [opts.order] };
      }

      // SELECT pg_advisory_xact_lock(...)
      if (s.startsWith("SELECT PG_ADVISORY_XACT_LOCK")) return { rows: [] };

      // UPDATE orders ... payment_status
      if (s.startsWith("UPDATE ORDERS") && /PAYMENT_STATUS/.test(s)) {
        return { rows: [] };
      }

      // UPDATE orders SET status = ...
      if (s.startsWith("UPDATE ORDERS") && /SET\s+STATUS/.test(s)) {
        return { rows: [] };
      }

      // UPDATE vendor_orders SET payment_status
      if (
        s.startsWith("UPDATE VENDOR_ORDERS") &&
        /PAYMENT_STATUS/.test(s)
      ) {
        return { rows: [] };
      }

      // UPDATE vendor_orders SET status
      if (
        s.startsWith("UPDATE VENDOR_ORDERS") &&
        /SET\s+STATUS/.test(s)
      ) {
        return { rows: [] };
      }

      // SELECT ... FROM vendor_orders WHERE parent_order_id = ...
      // (used by vendor-notify fan-out — outside the transaction)
      if (
        s.startsWith("SELECT") &&
        /FROM\s+VENDOR_ORDERS\b/.test(s) &&
        opts.vendorIds
      ) {
        return {
          rows: opts.vendorIds.map((vid) => ({ vendor_id: vid })),
        };
      }

      // Generic UPDATE — cover UPDATE vendor_orders ... SET payment_method
      if (s.startsWith("UPDATE")) return { rows: [] };

      return { rows: [] };
    }),
    release: vi.fn(),
  };
  // Post-COMMIT vendor fan-out uses pool.query (client is released).
  // The verifyWebhookToken path (P0-2) ALSO uses pool.query, but as
  // its first call: SELECT env_var_name, label FROM webhook_secrets
  // WHERE ... Tests run with no DB rows registered, so the first
  // pool.query call returns [] and verifyWebhookToken falls through
  // to the env-var path. The SECOND pool.query call is the vendor
  // fan-out lookup, which returns the configured vendorIds.
  if (opts.vendorIds) {
    vi.mocked(pool.query)
      .mockResolvedValueOnce({ rows: [] } as never) // webhook_secrets (empty)
      .mockResolvedValue({
        rows: opts.vendorIds.map((vid) => ({ vendor_id: vid })),
      } as never);
  } else {
    // No vendor fan-out: still mock pool.query to return an empty
    // webhook_secrets registry so verifyWebhookToken falls through to
    // the env-var path (the test sets MOYASAR_WEBHOOK_SECRET).
    vi.mocked(pool.query).mockResolvedValue({ rows: [] } as never);
  }
  return { client, calls };
}

vi.mock("@/lib/db", () => ({
  pool: {
    connect: vi.fn(),
    query: vi.fn(async () => ({ rows: [] })),
  },
}));
vi.mock("@/lib/payments/moyasar", () => ({
  fetchPayment: vi.fn(),
  createInvoice: vi.fn(),
  toHalalas: vi.fn((n: number) => Math.round(n * 100)),
  mapMoyasarStatusToDb: vi.fn((s: string) =>
    s === "paid" || s === "captured"
      ? "paid"
      : s === "failed" || s === "voided" || s === "refunded"
        ? "failed"
        : "pending",
  ),
  isSarCurrency: vi.fn((c: string | undefined | null) => {
    if (!c) return true;
    return c.trim().toUpperCase() === "SAR";
  }),
}));
vi.mock("@/lib/orders/loyalty", () => ({
  awardPointsForOrder: vi.fn(),
  getLoyaltySettings: vi.fn(),
  resolveRedeemForOrder: vi.fn(),
}));
vi.mock("@/lib/payments/event-ledger", () => ({
  recordPaymentEvent: vi.fn(async () => "inserted"),
  finalizePaymentEvent: vi.fn(),
}));
vi.mock("@/lib/push", () => ({
  sendPushToUser: vi.fn(),
  sendPushToEndpoint: vi.fn(),
}));
vi.mock("@/lib/queue", () => ({
  enqueueAdminNewOrder: vi.fn(),
  enqueueOrderPaidSms: vi.fn(),
  enqueueNotifyVendorNewOrder: vi.fn(),
}));
vi.mock("@/lib/logger", () => ({
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
}));

import { pool } from "@/lib/db";
import { fetchPayment } from "@/lib/payments/moyasar";
import { recordPaymentEvent, finalizePaymentEvent } from "@/lib/payments/event-ledger";
import { enqueueNotifyVendorNewOrder } from "@/lib/queue";
import { POST } from "./route";

const PARENT_ORDER = {
  id: "00000000-0000-0000-0000-0000000000aa",
  payment_reference: "inv-paid-1",
  total: 99.5,
  catalog_subtotal: 80,
  points_redeemed: 0,
  payment_status: "pending",
  status: "pending",
  user_id: null,
  guest_phone: null,
  guest_name: null,
};

const PAID_REMOTE = {
  success: true,
  id: "inv-paid-1",
  status: "paid" as const,
  amountHalalas: 9950,
  currency: "SAR",
  metadata: { order_id: PARENT_ORDER.id },
};

function signedRequest(body: unknown, token = "test-secret") {
  return new Request("http://localhost/api/v1/payments/webhook", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
}

/**
 * Post-COMMIT vendor fan-out runs via `pool.query` (the transaction's
 * `client` is already released). This helper mocks a single
 * `pool.query` call to return the configured vendor_ids for the
 * fan-out's `SELECT vendor_id::text FROM vendor_orders WHERE parent_order_id = $1`.
 */
function mockPoolVendorQuery(vendorIds: string[]) {
  vi.mocked(pool.query).mockResolvedValueOnce({
    rows: vendorIds.map((vid) => ({ vendor_id: vid })),
  } as never);
}

describe("POST /api/v1/payments/webhook — auth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.MOYASAR_WEBHOOK_SECRET = "test-secret";
    process.env.ALLOW_INSECURE_WEBHOOK = "";
  });

  it("rejects unsigned requests with 401", async () => {
    const req = new Request("http://localhost/api/v1/payments/webhook", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "inv-paid-1" }),
    });
    const res = await POST(req as never);
    expect(res.status).toBe(401);
  });

  it("accepts HMAC-signed requests with 200", async () => {
    const { client } = makeFakeClient({
      order: PARENT_ORDER,
      paymentEventResult: "duplicate",
      vendorIds: ["vendor-1"],
    });
    vi.mocked(pool.connect).mockResolvedValueOnce(client as never);
    vi.mocked(fetchPayment).mockResolvedValueOnce(PAID_REMOTE);
    vi.mocked(recordPaymentEvent).mockResolvedValueOnce("duplicate");

    const res = await POST(signedRequest({ id: "inv-paid-1" }) as never);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({ received: true, duplicate: true });
  });
});

describe("POST /api/v1/payments/webhook — Bug A regression", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.MOYASAR_WEBHOOK_SECRET = "test-secret";
    process.env.ALLOW_INSECURE_WEBHOOK = "";
  });

  it("paid → orders.status='confirmed' (NEVER 'paid')", async () => {
    const { client, calls } = makeFakeClient({
      order: PARENT_ORDER,
      paymentEventResult: "inserted",
      vendorIds: ["vendor-1"],
    });
    vi.mocked(pool.connect).mockResolvedValueOnce(client as never);
    vi.mocked(fetchPayment).mockResolvedValueOnce(PAID_REMOTE);
    vi.mocked(recordPaymentEvent).mockResolvedValueOnce("inserted");

    const res = await POST(signedRequest({ id: "inv-paid-1" }) as never);
    expect(res.status).toBe(200);

    // Find the orders.status UPDATE
    const ordersStatus = calls.find(
      (c) =>
        c.sql.trim().toUpperCase().startsWith("WITH OLD AS") &&
        /SET\s+STATUS/i.test(c.sql),
    );
    expect(ordersStatus).toBeDefined();
    // The bug was passing ['paid', orderId]. The fix uses a CASE
    // expression with no literal status param. Verify no ['paid', ...] param.
    expect(JSON.stringify(ordersStatus?.params)).not.toMatch(/\"paid\"/);
  });

  it("paid → vendor_orders.status='confirmed' (Slice-3 fan-out, NEVER 'paid')", async () => {
    const { client, calls } = makeFakeClient({
      order: PARENT_ORDER,
      paymentEventResult: "inserted",
      vendorIds: ["vendor-1", "vendor-2"],
    });
    vi.mocked(pool.connect).mockResolvedValueOnce(client as never);
    vi.mocked(fetchPayment).mockResolvedValueOnce(PAID_REMOTE);
    vi.mocked(recordPaymentEvent).mockResolvedValueOnce("inserted");

    await POST(signedRequest({ id: "inv-paid-1" }) as never);

    // Find the vendor_orders.status UPDATE — it must use the CASE
    // pattern (no literal 'paid' status param).
    const vendorStatus = calls.find(
      (c) =>
        c.sql.trim().toUpperCase().startsWith("UPDATE VENDOR_ORDERS") &&
        /SET\s+STATUS/i.test(c.sql),
    );
    expect(vendorStatus).toBeDefined();
    expect(vendorStatus!.sql).toMatch(/CASE/i);
    expect(JSON.stringify(vendorStatus!.params)).not.toMatch(/\"paid\"/);
  });

  it("paid → vendor_orders.payment_status IS mirrored (Bug A invariant)", async () => {
    const { client, calls } = makeFakeClient({
      order: PARENT_ORDER,
      paymentEventResult: "inserted",
      vendorIds: ["vendor-1"],
    });
    vi.mocked(pool.connect).mockResolvedValueOnce(client as never);
    vi.mocked(fetchPayment).mockResolvedValueOnce(PAID_REMOTE);
    vi.mocked(recordPaymentEvent).mockResolvedValueOnce("inserted");

    await POST(signedRequest({ id: "inv-paid-1" }) as never);

    // Find the vendor_orders.payment_status mirror UPDATE
    const mirror = calls.find(
      (c) =>
        c.sql.trim().toUpperCase().startsWith("UPDATE VENDOR_ORDERS") &&
        /PAYMENT_STATUS/i.test(c.sql),
    );
    expect(mirror).toBeDefined();
    // The mirror must set payment_status='paid' for the children.
    expect(mirror!.sql).toMatch(/payment_status/i);
    // Parameter[0] is the payment_status value ('paid')
    expect(mirror!.params[0]).toBe("paid");
  });
});

describe("POST /api/v1/payments/webhook — ledger + replay", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.MOYASAR_WEBHOOK_SECRET = "test-secret";
  });

  it("calls recordPaymentEvent FIRST with gateway='moyasar'", async () => {
    const { client } = makeFakeClient({
      order: PARENT_ORDER,
      paymentEventResult: "inserted",
      vendorIds: ["vendor-1"],
    });
    vi.mocked(pool.connect).mockResolvedValueOnce(client as never);
    vi.mocked(fetchPayment).mockResolvedValueOnce(PAID_REMOTE);
    vi.mocked(recordPaymentEvent).mockResolvedValueOnce("inserted");

    await POST(signedRequest({ id: "inv-paid-1" }) as never);

    expect(vi.mocked(recordPaymentEvent)).toHaveBeenCalledTimes(1);
    // recordPaymentEvent(client, args) — args are the second positional
    expect(vi.mocked(recordPaymentEvent).mock.calls[0][1]).toMatchObject({
      invoiceId: "inv-paid-1",
      gateway: "moyasar",
    });
  });

  it("duplicate replay short-circuits and ack 200", async () => {
    const { client } = makeFakeClient({
      order: PARENT_ORDER,
      paymentEventResult: "duplicate",
    });
    vi.mocked(pool.connect).mockResolvedValueOnce(client as never);
    vi.mocked(fetchPayment).mockResolvedValueOnce(PAID_REMOTE);
    vi.mocked(recordPaymentEvent).mockResolvedValueOnce("duplicate");

    const res = await POST(signedRequest({ id: "inv-paid-1" }) as never);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({ received: true, duplicate: true });
    // No vendor notification on a duplicate replay
    expect(vi.mocked(enqueueNotifyVendorNewOrder)).not.toHaveBeenCalled();
    // FIX (P1-5): duplicate replay still finalizes the ledger row so
    // subsequent replays don't see status='received' forever.
    expect(vi.mocked(finalizePaymentEvent)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(finalizePaymentEvent).mock.calls[0][1]).toMatchObject({
      invoiceId: "inv-paid-1",
      gateway: "moyasar",
      status: "processed",
    });
  });

  it("finalizePaymentEvent runs after COMMIT", async () => {
    const { client } = makeFakeClient({
      order: PARENT_ORDER,
      paymentEventResult: "inserted",
      vendorIds: ["vendor-1"],
    });
    vi.mocked(pool.connect).mockResolvedValueOnce(client as never);
    vi.mocked(fetchPayment).mockResolvedValueOnce(PAID_REMOTE);
    vi.mocked(recordPaymentEvent).mockResolvedValueOnce("inserted");

    await POST(signedRequest({ id: "inv-paid-1" }) as never);

    expect(vi.mocked(finalizePaymentEvent)).toHaveBeenCalledTimes(1);
    // finalizePaymentEvent(client, args) — args are the second positional
    expect(vi.mocked(finalizePaymentEvent).mock.calls[0][1]).toMatchObject({
      invoiceId: "inv-paid-1",
      gateway: "moyasar",
      status: "processed",
      orderId: PARENT_ORDER.id,
    });
  });
});

describe("POST /api/v1/payments/webhook — Gap D closure (vendor notification)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.MOYASAR_WEBHOOK_SECRET = "test-secret";
  });

  it("paid → enqueues NOTIFY_VENDOR_NEW_ORDER for every child vendor", async () => {
    const { client } = makeFakeClient({
      order: PARENT_ORDER,
      paymentEventResult: "inserted",
      vendorIds: ["vendor-1", "vendor-2", "vendor-3"],
    });
    vi.mocked(pool.connect).mockResolvedValueOnce(client as never);
    vi.mocked(fetchPayment).mockResolvedValueOnce(PAID_REMOTE);
    vi.mocked(recordPaymentEvent).mockResolvedValueOnce("inserted");

    await POST(signedRequest({ id: "inv-paid-1" }) as never);

    expect(vi.mocked(enqueueNotifyVendorNewOrder)).toHaveBeenCalledTimes(3);
    expect(vi.mocked(enqueueNotifyVendorNewOrder).mock.calls[0][0]).toEqual({
      vendorId: "vendor-1",
      orderId: PARENT_ORDER.id,
    });
    expect(vi.mocked(enqueueNotifyVendorNewOrder).mock.calls[1][0]).toEqual({
      vendorId: "vendor-2",
      orderId: PARENT_ORDER.id,
    });
  });

  it("failed payment does NOT enqueue vendor notification", async () => {
    const { client } = makeFakeClient({
      order: { ...PARENT_ORDER, payment_status: "failed" },
      paymentEventResult: "inserted",
      vendorIds: ["vendor-1"],
    });
    vi.mocked(pool.connect).mockResolvedValueOnce(client as never);
    vi.mocked(fetchPayment).mockResolvedValueOnce({
      ...PAID_REMOTE,
      status: "failed" as const,
    });
    vi.mocked(recordPaymentEvent).mockResolvedValueOnce("inserted");

    await POST(signedRequest({ id: "inv-failed-1" }) as never);

    expect(vi.mocked(enqueueNotifyVendorNewOrder)).not.toHaveBeenCalled();
  });
});

describe("POST /api/v1/payments/webhook — currency / amount guards", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.MOYASAR_WEBHOOK_SECRET = "test-secret";
  });

  it("non-SAR currency rejects loyalty credit", async () => {
    const { client } = makeFakeClient({
      order: PARENT_ORDER,
      paymentEventResult: "inserted",
      vendorIds: ["vendor-1"],
    });
    vi.mocked(pool.connect).mockResolvedValueOnce(client as never);
    vi.mocked(fetchPayment).mockResolvedValueOnce({
      ...PAID_REMOTE,
      currency: "KWD",
    });
    vi.mocked(recordPaymentEvent).mockResolvedValueOnce("inserted");

    const res = await POST(signedRequest({ id: "inv-paid-1" }) as never);
    expect(res.status).toBe(200);
    // KWD currency means we ack but skip loyalty / status promotion.
    // The vendor payment_status mirror CAN still run (it's at the top
    // of the paid branch before the currency guard).
  });

  it("underpayment rejects loyalty credit", async () => {
    const { client } = makeFakeClient({
      order: PARENT_ORDER,
      paymentEventResult: "inserted",
      vendorIds: ["vendor-1"],
    });
    vi.mocked(pool.connect).mockResolvedValueOnce(client as never);
    vi.mocked(fetchPayment).mockResolvedValueOnce({
      ...PAID_REMOTE,
      amountHalalas: 100, // 1.00 SAR vs order total 99.5
    });
    vi.mocked(recordPaymentEvent).mockResolvedValueOnce("inserted");

    const res = await POST(signedRequest({ id: "inv-paid-1" }) as never);
    expect(res.status).toBe(200);
  });
});

describe("POST /api/v1/payments/webhook — COMMIT ordering (P0-2 regression)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.MOYASAR_WEBHOOK_SECRET = "test-secret";
  });

  it("vendor push enqueue is called AFTER COMMIT (Bug A, Gap D commit-ordering regression)", async () => {
    // Capture the order of operations by recording the index of COMMIT
    // and the index of enqueueNotifyVendorNewOrder.
    const opOrder: string[] = [];
    const { client } = makeFakeClient({
      order: PARENT_ORDER,
      paymentEventResult: "inserted",
      vendorIds: ["vendor-1"],
    });
    // Wrap client.query so we can detect the COMMIT call.
    const wrapped = vi.fn(async (sql: string, params: unknown[] = []) => {
      const s = sql.trim().toUpperCase();
      if (s.startsWith("COMMIT")) opOrder.push("COMMIT");
      return client.query(sql, params);
    });
    const wrappedClient = { ...client, query: wrapped };
    vi.mocked(pool.connect).mockResolvedValueOnce(wrappedClient as never);
    vi.mocked(fetchPayment).mockResolvedValueOnce(PAID_REMOTE);
    vi.mocked(recordPaymentEvent).mockResolvedValueOnce("inserted");
    vi.mocked(enqueueNotifyVendorNewOrder).mockImplementation(() => {
      opOrder.push("enqueueNotifyVendorNewOrder");
      return Promise.resolve({ queued: true, jobId: "test" });
    });

    await POST(signedRequest({ id: "inv-paid-1" }) as never);

    const commitIdx = opOrder.indexOf("COMMIT");
    const enqueueIdx = opOrder.indexOf("enqueueNotifyVendorNewOrder");
    expect(commitIdx).toBeGreaterThanOrEqual(0);
    expect(enqueueIdx).toBeGreaterThanOrEqual(0);
    expect(commitIdx).toBeLessThan(enqueueIdx);
  });
});

describe("POST /api/v1/payments/webhook — guards do NOT short-circuit finalize (P0-3 regression)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.MOYASAR_WEBHOOK_SECRET = "test-secret";
  });

  it("currency mismatch still finalizes ledger + fires vendor notify (P0-3 fix)", async () => {
    const { client } = makeFakeClient({
      order: PARENT_ORDER,
      paymentEventResult: "inserted",
      vendorIds: ["vendor-1"],
    });
    vi.mocked(pool.connect).mockResolvedValueOnce(client as never);
    vi.mocked(fetchPayment).mockResolvedValueOnce({
      ...PAID_REMOTE,
      currency: "KWD", // currency guard fails
    });
    vi.mocked(recordPaymentEvent).mockResolvedValueOnce("inserted");

    const res = await POST(signedRequest({ id: "inv-paid-1" }) as never);
    expect(res.status).toBe(200);

    // FIX (P0-3): the ledger row MUST be finalized even when the
    // currency guard fails. Previously the early-return skipped
    // finalizePaymentEvent AND the vendor notify, leaving the ledger
    // stuck at status='received' and the vendor uninformed.
    expect(vi.mocked(finalizePaymentEvent)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(enqueueNotifyVendorNewOrder)).toHaveBeenCalledTimes(1);
  });

  it("underpayment still finalizes ledger + fires vendor notify (P0-3 fix)", async () => {
    const { client } = makeFakeClient({
      order: PARENT_ORDER,
      paymentEventResult: "inserted",
      vendorIds: ["vendor-1", "vendor-2"],
    });
    vi.mocked(pool.connect).mockResolvedValueOnce(client as never);
    vi.mocked(fetchPayment).mockResolvedValueOnce({
      ...PAID_REMOTE,
      amountHalalas: 100, // way under 99.5 SAR order total
    });
    vi.mocked(recordPaymentEvent).mockResolvedValueOnce("inserted");

    const res = await POST(signedRequest({ id: "inv-paid-1" }) as never);
    expect(res.status).toBe(200);

    // FIX (P0-3): same as above — guard fail must NOT skip finalize
    // or vendor notify. payment_status='paid' is gateway-confirmed;
    // the lifecycle flip (status='confirmed') is the only thing gated.
    expect(vi.mocked(finalizePaymentEvent)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(enqueueNotifyVendorNewOrder)).toHaveBeenCalledTimes(2);
  });
});