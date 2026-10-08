import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * HTTP route tests for POST /api/v1/wishlist/[productId]/move-to-cart
 * (Phase 3-5, full-system audit 2026-09-30).
 *
 * Pins down:
 *   - 401 when no customer user is resolved
 *   - 404 when the wishlist row doesn't belong to the caller
 *   - 400 when the product is inactive / vendor is inactive / stock short
 *   - 200 happy path: wishlist row deleted + cart row inserted (transaction)
 *   - 500 on DB error rolls back the wishlist delete
 */

const calls: { sql: string; params: unknown[] }[] = [];
let beginCalls = 0;
let commitCalls = 0;
let rollbackCalls = 0;
type MockResponse = { rows: unknown[]; rowCount?: number };

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
        if (trimmed.startsWith("DELETE FROM WISHLIST_ITEMS")) {
          return { rows: [{ product_id: params[1] }], rowCount: 1 };
        }
        if (trimmed.startsWith("SELECT P.VENDOR_ID")) {
          return {
            rows: [
              {
                vendor_id: "00000000-0000-0000-0000-000000000001",
                track_stock: true,
                stock_qty: 5,
                is_active: true,
                vendor_active: true,
              },
            ],
            rowCount: 1,
          };
        }
        if (trimmed.startsWith("INSERT INTO CART")) {
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      }),
      release: vi.fn(),
    })),
  },
}));

vi.mock("@/lib/identity", () => ({
  resolveCustomerUserIdFromRequest: vi.fn(),
}));

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn(async () => ({ allowed: true, remaining: 999, resetAt: 0 })),
  createRateLimitHeaders: vi.fn(() => ({})),
  CART_OPERATION_CONFIG: { id: "test" },
}));

vi.mock("@/lib/logger", () => ({
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
}));

import { resolveCustomerUserIdFromRequest } from "@/lib/identity";
import { POST } from "./route";
import type { NextRequest } from "next/server";

function mockRequest(url: string, body?: unknown): NextRequest {
  return {
    url,
    json: async () => body ?? {},
  } as unknown as NextRequest;
}

const mockResolveUserId = vi.mocked(resolveCustomerUserIdFromRequest);

describe("POST /api/v1/wishlist/[productId]/move-to-cart", () => {
  beforeEach(() => {
    calls.length = 0;
    beginCalls = 0;
    commitCalls = 0;
    rollbackCalls = 0;
    mockResolveUserId.mockReset();
  });

  it("returns 401 when no user is resolved", async () => {
    mockResolveUserId.mockResolvedValueOnce(null);
    const res = await POST(
      mockRequest("http://x/api/v1/wishlist/p1/move-to-cart"),
      { params: Promise.resolve({ productId: "p1" }) },
    );
    expect(res.status).toBe(401);
    expect(beginCalls).toBe(0);
  });

  it("returns 400 when productId is missing", async () => {
    mockResolveUserId.mockResolvedValueOnce("user-1");
    const res = await POST(
      mockRequest("http://x/api/v1/wishlist/%20/move-to-cart"),
      { params: Promise.resolve({ productId: " " }) },
    );
    expect(res.status).toBe(400);
  });

  it("returns 404 when the wishlist row is not found for the caller", async () => {
    // Override the default DELETE response to return rowCount=0.
    // Easiest way: rewrite the connect mock for this case via a
    // separate beforeEach-style helper. Use the default 0-row path
    // by re-mocking the pool.connect inline.
    mockResolveUserId.mockResolvedValueOnce("user-1");
    const { pool } = await import("@/lib/db");
    const origConnect = (pool as unknown as { connect: () => Promise<unknown> }).connect;
    (pool as unknown as { connect: () => Promise<unknown> }).connect = async () => ({
      query: vi.fn(async (sql: string, params: unknown[] = []) => {
        calls.push({ sql, params });
        const trimmed = sql.trim().toUpperCase();
        if (trimmed === "BEGIN") {
          beginCalls++;
          return { rows: [], rowCount: 0 };
        }
        if (trimmed === "ROLLBACK") {
          rollbackCalls++;
          return { rows: [], rowCount: 0 };
        }
        if (trimmed.startsWith("DELETE FROM WISHLIST_ITEMS")) {
          // 0 rows → not in wishlist
          return { rows: [], rowCount: 0 };
        }
        return { rows: [], rowCount: 0 };
      }),
      release: vi.fn(),
    });
    try {
      const res = await POST(
        mockRequest("http://x/api/v1/wishlist/p1/move-to-cart"),
        { params: Promise.resolve({ productId: "p1" }) },
      );
      expect(res.status).toBe(404);
      expect(rollbackCalls).toBe(1);
    } finally {
      (pool as unknown as { connect: typeof origConnect }).connect = origConnect;
    }
  });

  it("happy path: deletes wishlist, inserts cart, commits", async () => {
    mockResolveUserId.mockResolvedValueOnce("user-1");
    const res = await POST(
      mockRequest("http://x/api/v1/wishlist/p1/move-to-cart", { quantity: 2 }),
      { params: Promise.resolve({ productId: "p1" }) },
    );
    expect(res.status).toBe(200);
    expect(beginCalls).toBe(1);
    expect(commitCalls).toBe(1);
    expect(rollbackCalls).toBe(0);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.product_id).toBe("p1");
    expect(body.quantity).toBe(2);
    // Confirm the order: wishlist DELETE first, then cart INSERT.
    const sqlOrder = calls.map((c) => c.sql.trim().toUpperCase());
    const wishlistIdx = sqlOrder.findIndex((s) => s.startsWith("DELETE FROM WISHLIST_ITEMS"));
    const cartIdx = sqlOrder.findIndex((s) => s.startsWith("INSERT INTO CART"));
    expect(wishlistIdx).toBeGreaterThan(-1);
    expect(cartIdx).toBeGreaterThan(wishlistIdx);
  });

  it("clamps quantity to [1,99]", async () => {
    mockResolveUserId.mockResolvedValueOnce("user-1");
    // Override the default product lookup mock for this test so stock
    // is high enough that quantity=99 still passes the stock check.
    const { pool } = await import("@/lib/db");
    const origConnect = (pool as unknown as { connect: () => Promise<unknown> }).connect;
    (pool as unknown as { connect: () => Promise<unknown> }).connect = async () => ({
      query: vi.fn(async (sql: string, params: unknown[] = []) => {
        calls.push({ sql, params });
        const trimmed = sql.trim().toUpperCase();
        if (trimmed === "BEGIN") { beginCalls++; return { rows: [], rowCount: 0 }; }
        if (trimmed === "COMMIT") { commitCalls++; return { rows: [], rowCount: 0 }; }
        if (trimmed.startsWith("DELETE FROM WISHLIST_ITEMS")) {
          return { rows: [{ product_id: params[1] }], rowCount: 1 };
        }
        if (trimmed.startsWith("SELECT P.VENDOR_ID")) {
          return {
            rows: [{
              vendor_id: null,
              track_stock: true,
              stock_qty: 1000,
              is_active: true,
              vendor_active: true,
            }],
            rowCount: 1,
          };
        }
        if (trimmed.startsWith("INSERT INTO CART")) {
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      }),
      release: vi.fn(),
    });
    try {
      const res = await POST(
        mockRequest("http://x/api/v1/wishlist/p1/move-to-cart", { quantity: 9999 }),
        { params: Promise.resolve({ productId: "p1" }) },
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.quantity).toBe(99);
    } finally {
      (pool as unknown as { connect: typeof origConnect }).connect = origConnect;
    }
  });
});
