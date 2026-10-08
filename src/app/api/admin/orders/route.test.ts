import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

/**
 * Regression test for GET /api/admin/orders.
 *
 * The single-order branch fetches order items via a subquery that was
 * migrated from the legacy `products` table to `products_unified`.
 * This test exercises the `?id=...` branch and asserts the captured
 * SQL includes `JOIN products_unified` and never a bare `JOIN products`.
 */

type QueryCall = { sql: string; params: unknown[] };

const calls: QueryCall[] = [];

vi.mock("@/lib/db", () => ({
  pool: { connect: vi.fn() },
  query: vi.fn(async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    const s = sql.trim().toUpperCase();
    // Single-order branch: first SELECT fetches the order row. Return a
    // stub so the route proceeds to the items subquery (the one that
    // joins products_unified). The SQL is composed from SQL fragments
    // so we use a tolerant regex instead of an exact-prefix match.
    if (/^\s*SELECT\s+O\.ID,\s+O\.STATUS\b/.test(s)) {
      return { rows: [{ id: "uuid-1", status: "pending" }] };
    }
    return { rows: [] };
  }),
}));

vi.mock('@/lib/identity', () => ({
  requireAdminApi: vi.fn().mockResolvedValue({
    admin: { id: "admin-1", permissions: ["manage_orders"] },
  }),
}))
vi.mock('@/lib/identity/admin-api-auth-db', () => ({
  requireAdminApi: vi.fn().mockResolvedValue({
    admin: { id: "admin-1", permissions: ["manage_orders"] },
  }),
}));
;

vi.mock("@/lib/admin-audit", () => ({
  logAdminAction: vi.fn(),
}));

vi.mock("@/lib/validation", () => ({
  updateOrderSchema: { safeParse: vi.fn() },
}));

import { GET } from "./route";

function mockRequest(url: string): Request {
  return { headers: { get: () => null }, url } as unknown as Request;
}

describe("GET /api/admin/orders — products_unified migration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    calls.length = 0;
  });

  it("single-order branch joins order_items to products_unified", async () => {
    await GET(
      mockRequest("http://localhost/api/admin/orders?id=uuid-1") as never,
    );

    const queriedProducts = calls.some(
      (c) =>
        c.sql.toUpperCase().match(/\bFROM\s+products\b/i) ||
        c.sql.toUpperCase().match(/\bJOIN\s+products\b(?!_unified)/i),
    );
    expect(queriedProducts).toBe(false);

    const usesUnified = calls.some(
      (c) =>
        c.sql.toUpperCase().match(/\bFROM\s+products_unified\b/i) ||
        c.sql.toUpperCase().match(/\bJOIN\s+products_unified\b/i),
    );
    expect(usesUnified).toBe(true);
  });
});

/**
 * Tests for PUT /api/admin/orders — PCP-170 (Phase 16) rate limit.
 *
 * The rate limit must be enforced BEFORE any DB work (input validation
 * runs first per the rate-limit placement rule, then the rate limit
 * itself).
 */
import { PUT } from "./route";

const checkRateLimit = vi.fn();
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: (...args: unknown[]) => checkRateLimit(...args),
  ADMIN_WRITE_CONFIG: { windowMs: 60000, maxRequests: 30, keyPrefix: "admin:write" },
  ADMIN_WRITE_IP_CONFIG: { windowMs: 60000, maxRequests: 60, keyPrefix: "admin:write:ip" },
}));

const getClientIp = vi.fn().mockReturnValue("127.0.0.1");
vi.mock("@/lib/request-ip", () => ({
  getClientIp: (...args: unknown[]) => getClientIp(...args),
}));

const updateOrderSchema = { safeParse: vi.fn() };
vi.mock("@/lib/validation", () => ({
  updateOrderSchema: {
    safeParse: (...args: unknown[]) => updateOrderSchema.safeParse(...args),
  },
}));

vi.mock("@/lib/orders/loyalty", () => ({
  awardPointsForOrder: vi.fn(),
  getLoyaltySettings: vi.fn(),
  resolveRedeemForOrder: vi.fn(),
}));

vi.mock("@/lib/orders/state-machine", () => ({
  ALL_ORDER_STATES: [],
  ALL_PAYMENT_STATES: [],
  assertValidTransition: vi.fn(),
  invalidTransitionMessage: vi.fn(),
}));

vi.mock("@/lib/logger", () => ({
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
}));

function mockPutRequest(url: string, body: object = {}): NextRequest {
  return {
    headers: { get: () => null },
    url,
    json: async () => body,
  } as unknown as NextRequest;
}

describe("PUT /api/admin/orders — PCP-170 rate limit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    calls.length = 0;
    checkRateLimit.mockResolvedValue({ allowed: true, remaining: 30, resetAt: Date.now() + 60000 });
    updateOrderSchema.safeParse.mockReturnValue({ success: true, data: {} });
  });

  it("returns 429 when IP rate limit is exceeded", async () => {
    checkRateLimit.mockImplementation((key: string) => {
      if (key === "127.0.0.1") {
        return Promise.resolve({ allowed: false, remaining: 0, retryAfterMs: 30000 });
      }
      return Promise.resolve({ allowed: true, remaining: 30 });
    });
    const res = await PUT(mockPutRequest("http://x/api/admin/orders?id=u1"));
    expect(res.status).toBe(429);
  });

  it("returns 429 when admin rate limit is exceeded", async () => {
    checkRateLimit.mockImplementation((key: string) => {
      if (key === "admin:admin-1") {
        return Promise.resolve({ allowed: false, remaining: 0, retryAfterMs: 30000 });
      }
      return Promise.resolve({ allowed: true, remaining: 60 });
    });
    const res = await PUT(mockPutRequest("http://x/api/admin/orders?id=u1"));
    expect(res.status).toBe(429);
  });

  it("does NOT query the DB when rate limit fails (input validation is skipped)", async () => {
    checkRateLimit.mockResolvedValueOnce({ allowed: false, remaining: 0 });
    const res = await PUT(mockPutRequest("http://x/api/admin/orders?id=u1"));
    expect(res.status).toBe(429);
    // No DB calls for the actual update
    const updateCalls = calls.filter((c) => /^UPDATE\s+orders/i.test(c.sql.trim()));
    expect(updateCalls.length).toBe(0);
  });
});
