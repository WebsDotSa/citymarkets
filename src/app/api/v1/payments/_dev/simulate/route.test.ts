import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";

/**
 * HTTP route tests for POST /api/v1/payments/_dev/simulate
 * (Phase 3-8, full-system audit 2026-09-30).
 *
 * Pins down:
 *   - 404 in production
 *   - 401 when DEV_SIMULATE_TOKEN is set and the bearer token is wrong
 *   - 400 on missing invoice_id
 *   - 404 when no order has the given payment_reference
 *   - 200 happy path: BEGIN + SELECT order + reconcilePayment + COMMIT
 */

const previousNodeEnv = process.env.NODE_ENV;
const previousToken = process.env.DEV_SIMULATE_TOKEN;

const calls: { sql: string; params: unknown[] }[] = [];
type MockResponse = { rows: unknown[]; rowCount?: number };

let beginCalls = 0;
let commitCalls = 0;
let rollbackCalls = 0;

// NODE_ENV is typed as readonly on the NodeJS.ProcessEnv interface
// so direct assignment is a TS2540 error. Use a small helper that
// casts through `unknown` for test-only mutation.
function setNodeEnv(value: string): void {
  (process.env as unknown as Record<string, string>).NODE_ENV = value;
}

vi.mock("@/lib/db", () => ({
  pool: {
    connect: vi.fn(async () => ({
      query: vi.fn(async (sql: string, params: unknown[] = []) => {
        calls.push({ sql, params });
        const trimmed = sql.trim().toUpperCase();
        if (trimmed === "BEGIN") {
          beginCalls++;
          return { rows: [], rowCount: 0 };
        }
        if (trimmed === "COMMIT") {
          commitCalls++;
          return { rows: [], rowCount: 0 };
        }
        if (trimmed === "ROLLBACK") {
          rollbackCalls++;
          return { rows: [], rowCount: 0 };
        }
        if (trimmed.startsWith("SELECT ID, TOTAL")) {
          // Lookup is by payment_reference = $1. The "missing"
          // sentinel simulates an unknown invoice_id.
          if (params[0] === "missing") {
            return { rows: [], rowCount: 0 };
          }
          return {
            rows: [
              {
                id: "order-1",
                total: "100.00",
                catalog_subtotal: "80.00",
                user_id: null,
                points_redeemed: "0",
                guest_phone: "+966500000000",
                payment_reference: "inv_test_1",
              },
            ],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      }),
      release: vi.fn(),
    })),
  },
}));

vi.mock("@/lib/payments/reconcile-payment", () => ({
  reconcilePayment: vi.fn(async () => ({ recoveredCount: 0, duplicate: false })),
}));

vi.mock("@/lib/logger", () => ({
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
}));

import { POST, GET } from "./route";
import { reconcilePayment } from "@/lib/payments/reconcile-payment";
import type { NextRequest } from "next/server";

function mockRequest(body?: unknown, headers?: Record<string, string>): NextRequest {
  return {
    url: "http://x/api/v1/payments/_dev/simulate",
    json: async () => body ?? {},
    headers: {
      get: (k: string) => headers?.[k.toLowerCase()] ?? null,
    } as unknown as Headers,
  } as unknown as NextRequest;
}

const mockReconcile = vi.mocked(reconcilePayment);

describe("POST /api/v1/payments/_dev/simulate", () => {
  beforeEach(() => {
    calls.length = 0;
    beginCalls = 0;
    commitCalls = 0;
    rollbackCalls = 0;
    mockReconcile.mockReset();
    mockReconcile.mockResolvedValue({ recoveredCount: 0, duplicate: false });
    delete process.env.DEV_SIMULATE_TOKEN;
    setNodeEnv("test");
  });

  it("returns 404 in production", async () => {
    setNodeEnv("production");
    try {
      const res = await POST(mockRequest({ invoice_id: "inv_1", status: "paid" }));
      expect(res.status).toBe(404);
      expect(beginCalls).toBe(0);
    } finally {
      setNodeEnv("test");
    }
  });

  it("returns 401 when DEV_SIMULATE_TOKEN is set and bearer is wrong", async () => {
    process.env.DEV_SIMULATE_TOKEN = "expected-token";
    try {
      const res = await POST(
        mockRequest(
          { invoice_id: "inv_1", status: "paid" },
          { authorization: "Bearer wrong" },
        ),
      );
      expect(res.status).toBe(401);
    } finally {
      delete process.env.DEV_SIMULATE_TOKEN;
    }
  });

  it("accepts a matching bearer token", async () => {
    process.env.DEV_SIMULATE_TOKEN = "expected-token";
    try {
      const res = await POST(
        mockRequest(
          { invoice_id: "inv_test_1", status: "paid" },
          { authorization: "Bearer expected-token" },
        ),
      );
      expect(res.status).toBe(200);
    } finally {
      delete process.env.DEV_SIMULATE_TOKEN;
    }
  });

  it("returns 400 when invoice_id is missing", async () => {
    const res = await POST(mockRequest({ status: "paid" }));
    expect(res.status).toBe(400);
  });

  it("returns 404 when no order matches the invoice_id", async () => {
    const res = await POST(mockRequest({ invoice_id: "missing" }));
    expect(res.status).toBe(404);
    expect(rollbackCalls).toBe(1);
  });

  it("happy path: opens tx, fetches order, calls reconcilePayment, commits", async () => {
    const res = await POST(
      mockRequest({ invoice_id: "inv_test_1", status: "paid" }),
    );
    expect(res.status).toBe(200);
    expect(beginCalls).toBe(1);
    expect(commitCalls).toBe(1);
    expect(rollbackCalls).toBe(0);
    expect(mockReconcile).toHaveBeenCalledOnce();
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.simulated).toBe(true);
    expect(body.order_id).toBe("order-1");
    expect(body.recovered_count).toBe(0);
    expect(body.duplicate).toBe(false);
  });

  it("defaults gateway to moyasar + event_type to payment_paid", async () => {
    await POST(mockRequest({ invoice_id: "inv_test_1", status: "paid" }));
    const call = mockReconcile.mock.calls[0]?.[1];
    expect(call?.gateway).toBe("moyasar");
    expect(call?.eventType).toBe("payment_paid");
    expect(call?.paymentDb).toBe("paid");
  });

  it("maps refunded → paid (collapses non-canonical terminal status)", async () => {
    await POST(mockRequest({ invoice_id: "inv_test_1", status: "refunded" }));
    const call = mockReconcile.mock.calls[0]?.[1];
    expect(call?.eventType).toBe("payment_refunded");
    expect(call?.paymentDb).toBe("paid"); // collapsed: refunded doesn't have its own DB enum
  });

  it("falls back to 'paid' on an unknown status string", async () => {
    await POST(mockRequest({ invoice_id: "inv_test_1", status: "wat" }));
    const call = mockReconcile.mock.calls[0]?.[1];
    expect(call?.eventType).toBe("payment_paid");
    expect(call?.paymentDb).toBe("paid");
  });
});

describe("GET /api/v1/payments/_dev/simulate", () => {
  beforeEach(() => {
    setNodeEnv("test");
  });

  it("returns 404 in production", async () => {
    setNodeEnv("production");
    try {
      const res = await GET();
      expect(res.status).toBe(404);
    } finally {
      setNodeEnv("test");
    }
  });

  it("returns a doc payload in non-production", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.body_shape.invoice_id).toMatch(/payment_reference/);
  });
});

// Restore NODE_ENV + DEV_SIMULATE_TOKEN after the suite finishes.
afterAll(() => {
  if (previousNodeEnv === undefined) {
    delete (process.env as unknown as Record<string, string>).NODE_ENV;
  } else {
    setNodeEnv(previousNodeEnv);
  }
  if (previousToken === undefined) delete process.env.DEV_SIMULATE_TOKEN;
  else process.env.DEV_SIMULATE_TOKEN = previousToken;
});
