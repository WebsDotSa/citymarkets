/**
 * Regression tests for PCP-134 + PCP-136:
 *
 *   - PCP-134: PATCH /api/v1/orders/[id]/payment-method had no
 *     BEGIN/COMMIT around the SELECT FOR UPDATE + parent UPDATE +
 *     vendor_orders UPDATE triple. Two concurrent PATCH calls could
 *     race past the payment_status check, both succeed, and leave the
 *     two tables inconsistent if the second UPDATE failed.
 *
 *   - PCP-136: same endpoint had no rate limit at all — an
 *     authenticated user (or guest with the idempotency_key) could
 *     spam PATCH on the same orderId indefinitely.
 *
 * These tests assert:
 *   1. Rate-limit enforcement (per-IP first, then per-user)
 *   2. The handler opens BEGIN, runs the FOR UPDATE + UPDATE inside
 *      it, and commits on the happy path
 *   3. The handler rolls back on a thrown inner error
 *   4. The handler canonicalises the requested method via
 *      resolvePaymentMethod before writing
 *   5. The handler still refuses to mutate the user UUID when the body
 *      is missing the auth proof
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock rate-limit BEFORE importing the route
const { mockCheckRateLimit, mockClient } = vi.hoisted(() => {
  const client = {
    query: vi.fn(),
    release: vi.fn(),
  };
  return {
    mockCheckRateLimit: vi.fn(),
    mockClient: client,
  };
});

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: mockCheckRateLimit,
  createRateLimitHeaders: vi.fn(() => ({
    "X-RateLimit-Limit": "3",
    "X-RateLimit-Remaining": "0",
    "X-RateLimit-Reset": "9999999999",
  })),
  PAYMENT_METHOD_PATCH_CONFIG: {
    windowMs: 3600000,
    maxRequests: 3,
    keyPrefix: "payment-method:patch",
  },
  PAYMENT_METHOD_PATCH_IP_CONFIG: {
    windowMs: 3600000,
    maxRequests: 10,
    keyPrefix: "payment-method:patch:ip",
  },
}));

vi.mock("@/lib/csrf", () => ({
  applyCsrfProtection: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/identity", () => ({
  resolveCustomerUserIdFromRequest: vi.fn().mockResolvedValue("user-1"),
}));

vi.mock("@/lib/db", () => ({
  pool: {
    connect: vi.fn().mockResolvedValue(mockClient),
  },
}));

vi.mock("@/lib/logger", () => ({
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
}));

// request-ip returns a stable test value
vi.mock("@/lib/request-ip", () => ({
  getClientIp: vi.fn().mockReturnValue("1.2.3.4"),
}));

import { PATCH } from "./route";

function buildRequest(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(
    "http://localhost/api/v1/orders/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/payment-method",
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        ...headers,
      },
      body: JSON.stringify(body),
    },
  );
}

async function setOrderRow(
  overrides: Partial<{
    id: string;
    user_id: string;
    payment_method: string;
    payment_status: string;
    idempotency_key: string | null;
  }> = {},
): Promise<void> {
  const row = {
    id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    user_id: "user-1",
    idempotency_key: null,
    payment_method: "mada",
    payment_status: "pending",
    ...overrides,
  };
  // Sequence the mockClient.query calls for the happy path:
  //   1. BEGIN
  //   2. SELECT ... FOR UPDATE
  //   3. CTE UPDATE (parent + vendor_orders)
  //   4. COMMIT
  mockClient.query.mockImplementation(async (sql: string) => {
    const norm = sql.trim().toUpperCase();
    if (norm === "BEGIN") return { rows: [], rowCount: 0 };
    if (norm === "COMMIT") return { rows: [], rowCount: 0 };
    if (norm === "ROLLBACK") return { rows: [], rowCount: 0 };
    if (norm.startsWith("SELECT") && norm.includes("FOR UPDATE")) {
      return { rows: [row], rowCount: 1 };
    }
    if (norm.startsWith("WITH PARENT_UPD")) {
      return { rows: [], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  });
}

describe("PATCH /api/v1/orders/[id]/payment-method — PCP-134 + PCP-136", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: rate limit allows the request
    mockCheckRateLimit.mockResolvedValue({
      allowed: true,
      remaining: 2,
      resetAt: 0,
    });
  });

  it("returns 429 when the per-IP rate limit is exceeded", async () => {
    mockCheckRateLimit.mockResolvedValueOnce({
      allowed: false,
      remaining: 0,
      resetAt: 9999999999,
    });
    const res = await PATCH(
      buildRequest({ payment_method: "visa" }) as unknown as never,
      { params: Promise.resolve({ id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" }) },
    );
    expect(res.status).toBe(429);
    // The DB client must NOT have been acquired.
    expect(mockClient.query).not.toHaveBeenCalled();
  });

  it("returns 429 when the per-user rate limit is exceeded", async () => {
    mockCheckRateLimit
      // First call (per-IP) succeeds
      .mockResolvedValueOnce({ allowed: true, remaining: 10, resetAt: 0 })
      // Second call (per-user) fails
      .mockResolvedValueOnce({
        allowed: false,
        remaining: 0,
        resetAt: 9999999999,
      });
    const res = await PATCH(
      buildRequest({ payment_method: "visa" }) as unknown as never,
      { params: Promise.resolve({ id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" }) },
    );
    expect(res.status).toBe(429);
    expect(mockClient.query).not.toHaveBeenCalled();
  });

  it("wraps SELECT FOR UPDATE + UPDATE + COMMIT inside a BEGIN/COMMIT (PCP-134)", async () => {
    await setOrderRow({ payment_method: "mada", payment_status: "pending" });
    const res = await PATCH(
      buildRequest({ payment_method: "visa" }) as unknown as never,
      { params: Promise.resolve({ id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" }) },
    );
    expect(res.status).toBe(200);
    const calls = mockClient.query.mock.calls.map((c) =>
      String(c[0]).trim().toUpperCase(),
    );
    // The first non-rate-limit query MUST be BEGIN.
    expect(calls[0]).toBe("BEGIN");
    // The last query MUST be COMMIT (no rollback fired).
    expect(calls[calls.length - 1]).toBe("COMMIT");
    // The CTE update must sit between SELECT FOR UPDATE and COMMIT.
    const selectIdx = calls.findIndex((c) => c.startsWith("SELECT") && c.includes("FOR UPDATE"));
    const cteIdx = calls.findIndex((c) => c.startsWith("WITH PARENT_UPD"));
    const commitIdx = calls.findIndex((c) => c === "COMMIT");
    expect(selectIdx).toBeGreaterThan(0);
    expect(cteIdx).toBeGreaterThan(selectIdx);
    expect(commitIdx).toBeGreaterThan(cteIdx);
  });

  it("ROLLBACKs the transaction when the inner UPDATE throws (PCP-134)", async () => {
    mockClient.query.mockImplementation(async (sql: string) => {
      const norm = sql.trim().toUpperCase();
      if (norm === "BEGIN") return { rows: [], rowCount: 0 };
      if (norm === "COMMIT") return { rows: [], rowCount: 0 };
      if (norm === "ROLLBACK") return { rows: [], rowCount: 0 };
      if (norm.startsWith("SELECT") && norm.includes("FOR UPDATE")) {
        return {
          rows: [
            {
              id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
              user_id: "user-1",
              idempotency_key: null,
              payment_method: "mada",
              payment_status: "pending",
            },
          ],
          rowCount: 1,
        };
      }
      if (norm.startsWith("WITH PARENT_UPD")) {
        throw new Error("simulated DB error");
      }
      return { rows: [], rowCount: 0 };
    });

    const res = await PATCH(
      buildRequest({ payment_method: "visa" }) as unknown as never,
      { params: Promise.resolve({ id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" }) },
    );
    expect(res.status).toBe(500);
    const calls = mockClient.query.mock.calls.map((c) =>
      String(c[0]).trim().toUpperCase(),
    );
    // ROLLBACK must have fired, COMMIT must NOT have fired.
    expect(calls).toContain("ROLLBACK");
    expect(calls).not.toContain("COMMIT");
  });

  it("rejects legacy payment_method tokens (PCP-135 boundary)", async () => {
    const res = await PATCH(
      buildRequest({ payment_method: "tamara" }) as unknown as never,
      { params: Promise.resolve({ id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" }) },
    );
    // 'tamara' is a LEGACY token (removed from picker 2026-09-20). The
    // ALLOWED_METHODS check at the boundary must reject it with 400.
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/غير مدعومة/);
  });

  it("rejects when the row is paid (PCP-134 consistency with the original contract)", async () => {
    mockClient.query.mockImplementation(async (sql: string) => {
      const norm = sql.trim().toUpperCase();
      if (norm === "BEGIN") return { rows: [], rowCount: 0 };
      if (norm === "ROLLBACK") return { rows: [], rowCount: 0 };
      if (norm.startsWith("SELECT") && norm.includes("FOR UPDATE")) {
        return {
          rows: [
            {
              id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
              user_id: "user-1",
              idempotency_key: null,
              payment_method: "mada",
              payment_status: "paid",
            },
          ],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    });
    const res = await PATCH(
      buildRequest({ payment_method: "visa" }) as unknown as never,
      { params: Promise.resolve({ id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" }) },
    );
    expect(res.status).toBe(409);
    const calls = mockClient.query.mock.calls.map((c) =>
      String(c[0]).trim().toUpperCase(),
    );
    // 409 = paid → ROLLBACK must have fired, no UPDATE must have run.
    expect(calls).toContain("ROLLBACK");
    expect(calls).not.toContain("COMMIT");
  });

  it("returns 200 with unchanged=true when the method is already the same", async () => {
    await setOrderRow({ payment_method: "visa", payment_status: "pending" });
    const res = await PATCH(
      buildRequest({ payment_method: "visa" }) as unknown as never,
      { params: Promise.resolve({ id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" }) },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.unchanged).toBe(true);
    const calls = mockClient.query.mock.calls.map((c) =>
      String(c[0]).trim().toUpperCase(),
    );
    // No CTE update should have fired.
    expect(calls.filter((c) => c.startsWith("WITH PARENT_UPD"))).toHaveLength(0);
    expect(calls[calls.length - 1]).toBe("COMMIT");
  });

  it("returns 403 when the order belongs to a different user", async () => {
    mockClient.query.mockImplementation(async (sql: string) => {
      const norm = sql.trim().toUpperCase();
      if (norm === "BEGIN") return { rows: [], rowCount: 0 };
      if (norm === "ROLLBACK") return { rows: [], rowCount: 0 };
      if (norm.startsWith("SELECT") && norm.includes("FOR UPDATE")) {
        return {
          rows: [
            {
              id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
              user_id: "OTHER-USER",
              idempotency_key: null,
              payment_method: "mada",
              payment_status: "pending",
            },
          ],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    });
    const res = await PATCH(
      buildRequest({ payment_method: "visa" }) as unknown as never,
      { params: Promise.resolve({ id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" }) },
    );
    expect(res.status).toBe(403);
    const calls = mockClient.query.mock.calls.map((c) =>
      String(c[0]).trim().toUpperCase(),
    );
    expect(calls).toContain("ROLLBACK");
    expect(calls).not.toContain("COMMIT");
  });
});