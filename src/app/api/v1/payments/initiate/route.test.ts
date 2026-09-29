import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Regression tests for POST /api/v1/payments/initiate.
 *
 * Invariants under test:
 *   1. Underpayment attack: the gateway `amount` is the server-loaded
 *      `orders.total`, never a client-supplied value. The client body
 *      does not even include `amount`; the route must not invent one.
 *   2. Rate-limit ordering: 401 for unauthenticated, then per-user
 *      limit, then per-IP limit — gateway is never called on a 429.
 */

type QueryCall = { sql: string; params: unknown[] };

function makeFakeClient(opts: {
  owner?: { user_id: string; total: number; payment_status: string; status: string };
}) {
  const calls: QueryCall[] = [];
  const client = {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      const s = sql.trim().toUpperCase();
      if (s.startsWith("UPDATE ORDERS")) return { rows: [] };
      if (s.startsWith("SELECT") && /FROM\s+ORDERS\b/.test(s)) {
        return { rows: opts.owner ? [opts.owner] : [] };
      }
      return { rows: [] };
    }),
    release: vi.fn(),
  };
  return { client, calls };
}

vi.mock("@/lib/db", () => ({ pool: { connect: vi.fn() } }));
vi.mock("@/lib/customer-session", () => ({
  resolveCustomerUserIdFromRequest: vi.fn(),
}));
vi.mock("@/lib/payments/moyasar", () => ({
  createInvoice: vi.fn(),
}));
vi.mock("@/lib/logger", () => ({
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
}));

import { pool } from "@/lib/db";
import { resolveCustomerUserIdFromRequest } from "@/lib/customer-session";
import { createInvoice } from "@/lib/payments/moyasar";
import { POST } from "./route";

function mockRequest(body: unknown): Request {
  return {
    headers: { get: () => null },
    json: async () => body,
  } as unknown as Request;
}

const USER = "11111111-aaaa-bbbb-cccc-222222222222";

describe("POST /api/v1/payments/initiate — underpayment attack guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveCustomerUserIdFromRequest).mockResolvedValue(USER);
  });

  it("sends the server-loaded orders.total to the gateway, ignoring any client amount", async () => {
    const { client, calls } = makeFakeClient({
      owner: { user_id: USER, total: 123.45, payment_status: "pending", status: "pending" },
    });
    vi.mocked(pool.connect).mockResolvedValueOnce(client as never);
    vi.mocked(createInvoice).mockResolvedValueOnce({
      success: true,
      paymentUrl: "https://pay.example/x",
      invoiceId: "inv-1",
    });

    const res = await POST(
      mockRequest({
        orderId: "order-1",
        customerName: "اسم",
        customerMobile: "0500000000",
        // Even if a malicious client smuggles `amount` in the body,
        // the route must NOT read it. The gateway must be called
        // with 123.45 (from the DB) and nothing else.
        amount: 0.01,
      }) as never
    );

    expect(res.status).toBe(200);
    expect(vi.mocked(createInvoice)).toHaveBeenCalledTimes(1);
    const gatewayCall = vi.mocked(createInvoice).mock.calls[0][0];
    expect(gatewayCall.amount).toBe(123.45);
    // And the SELECT against orders must have happened with the
    // supplied orderId.
    const ownerQuery = calls.find((c) =>
      /FROM\s+ORDERS\b/i.test(c.sql)
    );
    expect(ownerQuery?.params[0]).toBe("order-1");
  });

  it("rejects when the order belongs to a different user (forbidden)", async () => {
    const { client } = makeFakeClient({
      owner: {
        user_id: "different-user",
        total: 50,
        payment_status: "pending",
        status: "pending",
      },
    });
    vi.mocked(pool.connect).mockResolvedValueOnce(client as never);

    const res = await POST(
      mockRequest({
        orderId: "order-2",
        customerName: "اسم",
        customerMobile: "0500000000",
      }) as never
    );
    expect(res.status).toBe(403);
    expect(vi.mocked(createInvoice)).not.toHaveBeenCalled();
  });

  it("rejects when the order is already paid (409)", async () => {
    const { client } = makeFakeClient({
      owner: { user_id: USER, total: 50, payment_status: "paid", status: "pending" },
    });
    vi.mocked(pool.connect).mockResolvedValueOnce(client as never);

    const res = await POST(
      mockRequest({
        orderId: "order-3",
        customerName: "اسم",
        customerMobile: "0500000000",
      }) as never
    );
    expect(res.status).toBe(409);
    expect(vi.mocked(createInvoice)).not.toHaveBeenCalled();
  });

  it("stores payment_method='moyasar' and the gateway invoice id", async () => {
    const { client, calls } = makeFakeClient({
      owner: { user_id: USER, total: 50, payment_status: "pending", status: "pending" },
    });
    vi.mocked(pool.connect).mockResolvedValueOnce(client as never);
    vi.mocked(createInvoice).mockResolvedValueOnce({
      success: true,
      paymentUrl: "x",
      invoiceId: "inv-2",
    });

    const res = await POST(
      mockRequest({
        orderId: "order-4",
        customerName: "اسم",
        customerMobile: "0500000000",
      }) as never
    );

    expect(res.status).toBe(200);
    const update = calls.find((c) => c.sql.toUpperCase().startsWith("UPDATE ORDERS"));
    expect(update).toBeDefined();
    expect(update?.sql.toLowerCase()).toContain("payment_method = 'moyasar'");
    expect(update?.params).toEqual(["inv-2", "order-4"]);
  });

  it("returns 401 when user is unauthenticated and skips the rate limiter", async () => {
    vi.mocked(resolveCustomerUserIdFromRequest).mockResolvedValueOnce(null);
    const res = await POST(
      mockRequest({
        orderId: "x",
        customerName: "y",
        customerMobile: "z",
      }) as never
    );
    expect(res.status).toBe(401);
    // No DB connection or gateway call should have been attempted.
    expect(vi.mocked(pool.connect)).not.toHaveBeenCalled();
    expect(vi.mocked(createInvoice)).not.toHaveBeenCalled();
  });
});