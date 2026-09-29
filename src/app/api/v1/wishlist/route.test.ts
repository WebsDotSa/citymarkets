import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * HTTP route tests for /api/v1/wishlist (P2-4).
 *
 * Pins down:
 *   - 401 when no customer user is resolved
 *   - 400 when product_id is missing
 *   - 200 with hydrated data on add / list
 *   - 409 when wishlist is full
 *   - DELETE with product_id → remove one
 *   - DELETE without product_id → clear all
 */

const calls: { sql: string; params: unknown[] }[] = [];
type MockResponse = { rows: unknown[]; rowCount?: number };
let responseStack: MockResponse[] = [];

vi.mock("@/lib/db", () => ({
  query: vi.fn(async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    if (responseStack.length > 0) {
      return responseStack.shift()!;
    }
    return { rows: [], rowCount: 0 };
  }),
}));

vi.mock("@/lib/identity", () => ({
  resolveCustomerUserIdFromRequest: vi.fn(),
}));

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn(async () => ({ allowed: true, remaining: 999, resetAt: 0 })),
  createRateLimitHeaders: vi.fn(() => ({})),
  CART_OPERATION_CONFIG: { id: "test" },
  GENERAL_API_CONFIG: { id: "test" },
}));

vi.mock("@/lib/logger", () => ({
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
}));

import { resolveCustomerUserIdFromRequest } from "@/lib/identity";
import { DELETE, GET, POST } from "./route";
import type { NextRequest } from "next/server";

function mockRequest(url: string, body?: unknown): NextRequest {
  return {
    headers: { get: () => null },
    url,
    json: async () => body,
  } as unknown as NextRequest;
}

const hydratedRow = {
  product_id: "p-1",
  added_at: "2026-09-29T12:00:00.000Z",
  id: "p-1",
  name: "Test",
  name_ar: "اختبار",
  slug: "test",
  price: 10,
  discount_price: null,
  image_url: null,
  vendor_id: "v-1",
  vendor_name: "V",
  vendor_slug: "v",
  is_active: true,
  stock_qty: 5,
};

beforeEach(() => {
  calls.length = 0;
  responseStack = [];
  vi.mocked(resolveCustomerUserIdFromRequest).mockReset();
});

describe("GET /api/v1/wishlist", () => {
  it("returns 401 when no customer is resolved", async () => {
    vi.mocked(resolveCustomerUserIdFromRequest).mockResolvedValue(null);
    const res = await GET(mockRequest("http://localhost/api/v1/wishlist") as never);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.success).toBe(false);
  });

  it("returns the hydrated wishlist for an authenticated user", async () => {
    vi.mocked(resolveCustomerUserIdFromRequest).mockResolvedValue("u-1");
    responseStack = [{ rows: [hydratedRow], rowCount: 1 }];
    const res = await GET(mockRequest("http://localhost/api/v1/wishlist") as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.count).toBe(1);
    expect(body.data[0].product.id).toBe("p-1");
    expect(body.data[0].product.price).toBe(10);
  });
});

describe("POST /api/v1/wishlist", () => {
  it("returns 401 when no customer is resolved", async () => {
    vi.mocked(resolveCustomerUserIdFromRequest).mockResolvedValue(null);
    const res = await POST(
      mockRequest("http://localhost/api/v1/wishlist", { product_id: "p-1" }) as never,
    );
    expect(res.status).toBe(401);
  });

  it("returns 400 when product_id is missing", async () => {
    vi.mocked(resolveCustomerUserIdFromRequest).mockResolvedValue("u-1");
    const res = await POST(
      mockRequest("http://localhost/api/v1/wishlist", {}) as never,
    );
    expect(res.status).toBe(400);
  });

  it("returns the hydrated item on success", async () => {
    vi.mocked(resolveCustomerUserIdFromRequest).mockResolvedValue("u-1");
    // EXISTS empty, COUNT 5, INSERT WITH JOIN returns the row
    responseStack = [
      { rows: [], rowCount: 0 },
      { rows: [{ c: 5 }], rowCount: 1 },
      { rows: [hydratedRow], rowCount: 1 },
    ];
    const res = await POST(
      mockRequest("http://localhost/api/v1/wishlist", { product_id: "p-1" }) as never,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.product.id).toBe("p-1");
  });

  it("returns 409 when the wishlist is full", async () => {
    vi.mocked(resolveCustomerUserIdFromRequest).mockResolvedValue("u-1");
    responseStack = [
      { rows: [], rowCount: 0 },
      { rows: [{ c: 50 }], rowCount: 1 },
    ];
    const res = await POST(
      mockRequest("http://localhost/api/v1/wishlist", { product_id: "p-99" }) as never,
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.reason).toBe("full");
    expect(body.error).toContain("50");
  });

  it("returns 200 with already_present when the product is duplicated", async () => {
    vi.mocked(resolveCustomerUserIdFromRequest).mockResolvedValue("u-1");
    responseStack = [{ rows: [{ product_id: "p-1" }], rowCount: 1 }];
    const res = await POST(
      mockRequest("http://localhost/api/v1/wishlist", { product_id: "p-1" }) as never,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.reason).toBe("already_present");
  });
});

describe("DELETE /api/v1/wishlist", () => {
  it("returns 401 when no customer is resolved", async () => {
    vi.mocked(resolveCustomerUserIdFromRequest).mockResolvedValue(null);
    const res = await DELETE(mockRequest("http://localhost/api/v1/wishlist?product_id=p-1") as never);
    expect(res.status).toBe(401);
  });

  it("removes a single product when product_id is provided", async () => {
    vi.mocked(resolveCustomerUserIdFromRequest).mockResolvedValue("u-1");
    responseStack = [{ rows: [], rowCount: 1 }];
    const res = await DELETE(
      mockRequest("http://localhost/api/v1/wishlist?product_id=p-1") as never,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(typeof body.removed).toBe("number");
    expect(calls.some((c) => /DELETE FROM wishlist_items/i.test(c.sql))).toBe(true);
  });

  it("clears all rows when product_id is omitted", async () => {
    vi.mocked(resolveCustomerUserIdFromRequest).mockResolvedValue("u-1");
    responseStack = [{ rows: [], rowCount: 7 }];
    const res = await DELETE(mockRequest("http://localhost/api/v1/wishlist") as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.removed).toBe(7);
  });
});
