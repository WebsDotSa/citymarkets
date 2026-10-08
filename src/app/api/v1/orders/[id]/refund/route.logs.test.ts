/**
 * Regression tests for PCP-143: customer refund route writes
 * `order_status_logs` with the WRONG column names.
 *
 * Background:
 *   The customer-initiated refund endpoint at
 *   src/app/api/v1/orders/[id]/refund/route.ts issues an INSERT against
 *   `order_status_logs` that names columns (`status`, `created_by`) which
 *   do not exist on the live schema. The live table has
 *   `(order_id, old_status, new_status, changed_by, notes, …)`. Every
 *   refund request hit `42703 column "status" of relation
 *   "order_status_logs" does not exist`, the catch block ROLLBACK'd the
 *   transaction, and the customer saw 500 "تعذّر تسجيل طلب الاسترداد"
 *   with no `refund_request_id` even though the request was
 *   financially valid.
 *
 * The fix changes the INSERT to use the canonical column names
 * (old_status / new_status / changed_by). These tests assert that the
 * emitted SQL is column-correct, which is the precise contract
 * downstream consumers depend on.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

type QueryCall = { sql: string; params: unknown[] };

// Per-test mock client hoisted so vi.mock can reference it.
const { mockClient, mockPool } = vi.hoisted(() => {
  const calls: QueryCall[] = [];
  const queue: Array<{ rowCount: number; rows: unknown[] }> = [];
  const client = {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      return queue.shift() ?? { rowCount: 0, rows: [] };
    }),
    release: vi.fn(),
  };
  return {
    mockClient: { client, calls, queue },
    mockPool: { connect: vi.fn() },
  };
});

const { mockCheckRateLimit } = vi.hoisted(() => ({
  mockCheckRateLimit: vi.fn(),
}));

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: mockCheckRateLimit,
  createRateLimitHeaders: vi.fn(() => ({
    "X-RateLimit-Limit": "3",
    "X-RateLimit-Remaining": "0",
    "X-RateLimit-Reset": "9999999999",
  })),
  REFUND_REQUEST_CONFIG: { windowMs: 3600000, maxRequests: 3, keyPrefix: "refund:request" },
  REFUND_REQUEST_IP_CONFIG: { windowMs: 3600000, maxRequests: 10, keyPrefix: "refund:request:ip" },
}));

vi.mock("@/lib/csrf", () => ({
  applyCsrfProtection: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/identity", () => ({
  resolveCustomerUserIdFromRequest: vi.fn().mockResolvedValue("user-1"),
}));

vi.mock("@/lib/db", () => ({
  pool: mockPool,
}));

vi.mock("@/lib/logger", () => ({
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
}));

import { POST } from "./route";

const orderId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const nowIso = new Date().toISOString();

function resetMock() {
  mockClient.calls.length = 0;
  mockClient.queue.length = 0;
  mockClient.client.query.mockClear();
  mockClient.client.release.mockClear();
  mockPool.connect.mockClear();
  mockPool.connect.mockResolvedValue(mockClient.client);
}

function enqueue(responses: Array<{ rowCount: number; rows: unknown[] }>) {
  mockClient.queue.push(...responses);
}

beforeEach(() => {
  vi.clearAllMocks();
  resetMock();
  mockCheckRateLimit.mockResolvedValue({ allowed: true, remaining: 2, resetAt: 0 });
});

describe("POST /api/v1/orders/[id]/refund — PCP-143 order_status_logs columns", () => {
  it("inserts order_status_logs with the canonical (old_status, new_status, changed_by) columns", async () => {
    enqueue([{ rowCount: 0, rows: [] }]); // BEGIN
    enqueue([
      {
        rowCount: 1,
        rows: [
          {
            id: orderId,
            user_id: "user-1",
            idempotency_key: null,
            payment_status: "paid",
            status: "confirmed",
            payment_reference: "moy-inv-1",
            created_at: nowIso,
          },
        ],
      },
    ]); // SELECT … FOR UPDATE
    enqueue([{ rowCount: 0, rows: [] }]); // SELECT refund_requests pending → none
    enqueue([{ rowCount: 1, rows: [{ id: "refund-uuid-1" }] }]); // INSERT refund_requests
    enqueue([{ rowCount: 1, rows: [] }]); // INSERT order_status_logs (under test)
    enqueue([{ rowCount: 0, rows: [] }]); // COMMIT

    const request = new Request(`http://localhost/api/v1/orders/${orderId}/refund`, {
      method: "POST",
      headers: {
        "x-forwarded-for": "1.2.3.4",
        "content-type": "application/json",
      },
      body: JSON.stringify({ reason: "test reason" }),
    });
    const res = await POST(request as never, {
      params: Promise.resolve({ id: orderId }),
    });
    expect(res.status).toBe(200);

    const logInsert = mockClient.calls.find((c) =>
      /^INSERT INTO order_status_logs/i.test(c.sql.trim()),
    );
    expect(logInsert, "expected an INSERT INTO order_status_logs call").toBeDefined();

    // Must NOT use the legacy / wrong column names that don't exist on the live table.
    // The bug was `(order_id, status, notes, created_by)`.
    expect(logInsert!.sql).not.toMatch(/\bstatus\b\s*,/i);
    expect(logInsert!.sql).not.toMatch(/\bcreated_by\b/i);

    // Must use the canonical column names from the live schema.
    expect(logInsert!.sql).toMatch(/old_status/i);
    expect(logInsert!.sql).toMatch(/new_status/i);
    expect(logInsert!.sql).toMatch(/changed_by/i);
  });

  it("returns 200 with refund_request_id (no 500) when status_log write uses correct columns", async () => {
    enqueue([{ rowCount: 0, rows: [] }]); // BEGIN
    enqueue([
      {
        rowCount: 1,
        rows: [
          {
            id: orderId,
            user_id: "user-1",
            idempotency_key: null,
            payment_status: "paid",
            status: "confirmed",
            payment_reference: "moy-inv-1",
            created_at: nowIso,
          },
        ],
      },
    ]);
    enqueue([{ rowCount: 0, rows: [] }]);
    enqueue([{ rowCount: 1, rows: [{ id: "refund-uuid-2" }] }]);
    enqueue([{ rowCount: 1, rows: [] }]);
    enqueue([{ rowCount: 0, rows: [] }]);

    const request = new Request(`http://localhost/api/v1/orders/${orderId}/refund`, {
      method: "POST",
      headers: {
        "x-forwarded-for": "1.2.3.4",
        "content-type": "application/json",
      },
      body: JSON.stringify({ reason: "x" }),
    });
    const res = await POST(request as never, {
      params: Promise.resolve({ id: orderId }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.refund_request_id).toBe("refund-uuid-2");
  });
});
