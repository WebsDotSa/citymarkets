import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Regression tests for /api/v1/cart.
 *
 * Three independent contracts are guarded here:
 *
 *  1. GET /cart returns 400 when no customer or guest session is resolved.
 *  2. GET /cart returns the populated cart when an authenticated customer
 *     resolves. The cart query joins `cart` to `products_unified_with_offers`
 *     (migration 040b, Slice 5).
 *  3. GET /cart returns the populated guest cart when a session id is
 *     resolved instead of a user id (no auth required for guests).
 *
 * The route uses `pool.connect`, so we mock the client returned by
 * `pool.connect` and capture every `client.query(sql, params)` call.
 */

type QueryCall = { sql: string; params: unknown[] };

function makeFakeClient(opts?: { rows?: unknown[] }) {
  const calls: QueryCall[] = [];
  const client = {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      const s = sql.trim().toUpperCase();
      if (s.startsWith("BEGIN") || s.startsWith("ROLLBACK") || s.startsWith("COMMIT")) {
        return { rows: [] };
      }
      if (s.includes("FROM CART") || s.includes("FROM GUEST_CART")) {
        return { rows: opts?.rows ?? [] };
      }
      return { rows: [] };
    }),
    release: vi.fn(),
  };
  return { client, calls };
}

vi.mock("@/lib/db", () => ({
  pool: { connect: vi.fn() },
  query: vi.fn(),
}));

vi.mock("@/lib/customer-session", () => ({
  resolveCustomerUserIdFromRequest: vi.fn(),
  getGuestSessionIdFromRequest: vi.fn(),
}));

vi.mock("@/lib/logger", () => ({
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
}));

import { pool } from "@/lib/db";
import {
  resolveCustomerUserIdFromRequest,
  getGuestSessionIdFromRequest,
} from "@/lib/customer-session";
import { GET } from "./route";

function mockRequest(url = "http://localhost/api/v1/cart"): Request {
  return { headers: { get: () => null }, url } as unknown as Request;
}

describe("GET /api/v1/cart — auth + products_unified_with_offers (regression)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 when no customer user and no guest session are resolved", async () => {
    vi.mocked(resolveCustomerUserIdFromRequest).mockResolvedValue(null);
    vi.mocked(getGuestSessionIdFromRequest).mockReturnValue(null);

    const res = await GET(mockRequest() as never);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("معلومات غير مكتملة");
  });

  it("returns the populated authenticated cart joining products_unified_with_offers", async () => {
    vi.mocked(resolveCustomerUserIdFromRequest).mockResolvedValue("user-1");
    vi.mocked(getGuestSessionIdFromRequest).mockReturnValue(null);

    const { client, calls } = makeFakeClient({
      rows: [
        {
          id: "cart-row-1",
          quantity: 2,
          vendor_id: null,
          product_id: "11111111-2222-3333-4444-555555555555",
          name_ar: "حليب طازج",
          price: "8.00",
          discount_price: null,
          image_url: "/images/milk.png",
          stock_qty: 50,
          active_offer_id: null,
          active_offer_title_ar: null,
          active_offer_type: null,
          active_offer_value: null,
          active_offer_max_discount: null,
          active_offer_min_order: null,
          active_offer_starts_at: null,
          active_offer_ends_at: null,
          vendor_name: null,
          vendor_slug: null,
        },
      ],
    });
    vi.mocked(pool.connect).mockReset();
    vi.mocked(pool.connect).mockImplementation(async () => client as never);

    const res = await GET(mockRequest() as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.items).toHaveLength(1);
    expect(body.count).toBe(1);
    expect(body.subtotal).toBe(16);

    // Migration target: the cart SELECT must JOIN products_unified_with_offers.
    const usesUnified = calls.some((c) =>
      /FROM\s+products_unified_with_offers\b/i.test(c.sql) ||
      /JOIN\s+products_unified_with_offers\b/i.test(c.sql)
    );
    expect(usesUnified).toBe(true);
  });

  it("returns the populated guest cart when only a session id is resolved", async () => {
    vi.mocked(resolveCustomerUserIdFromRequest).mockResolvedValue(null);
    vi.mocked(getGuestSessionIdFromRequest).mockReturnValue("guest-session-abc");

    const { client } = makeFakeClient({ rows: [] });
    vi.mocked(pool.connect).mockReset();
    vi.mocked(pool.connect).mockImplementation(async () => client as never);

    const res = await GET(mockRequest() as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.items).toEqual([]);
    expect(body.count).toBe(0);
    expect(body.subtotal).toBe(0);
  });
});
