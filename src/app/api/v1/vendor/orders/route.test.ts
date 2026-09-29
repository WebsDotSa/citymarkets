/**
 * HTTP route tests for GET /api/v1/vendor/orders.
 *
 * Invariants:
 *   1. Missing session → 401
 *   2. vendor_id is PINNED to session.vendorId (SQL: WHERE vo.vendor_id = $1)
 *   3. pagination shape { orders, pagination, statusCounts }
 *   4. status filter is bound (no SQL injection via the URL)
 *   5. count() runs the same WHERE clause as the SELECT (vendor-scoped)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const SESSION = {
  vendorId: "00000000-0000-0000-0000-0000000000a2",
  vendorSlug: "burger-palace",
  staffId: "staff-1",
  email: "owner@example.com",
  fullName: "Owner",
  role: "owner" as const,
  permissions: [],
};

const ORDER_ROW = {
  id: "vo-1",
  order_number: "ORD-001",
  status: "pending",
  payment_status: "paid",
  payment_method: "moyasar",
  customer_name: "محمد",
  customer_phone: "0501234567",
  customer_email: "m@example.com",
  address_text: "الرياض",
  subtotal: "100.00",
  delivery_fee: "10.00",
  total: "110.00",
  notes: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  items_count: "2",
};

vi.mock("@/lib/db", () => ({
  query: vi.fn(),
  pool: {
    connect: vi.fn(),
    query: vi.fn(async () => ({ rows: [] })),
  },
}));
vi.mock("@/lib/identity", () => ({
  signVendorSessionToken: vi.fn(),
  vendorSessionCookieOptions: vi.fn(() => ({})),
  VENDOR_SESSION_COOKIE: "vendor_session",
}));
vi.mock("@/lib/identity/vendor-auth-with-db", () => ({
  verifyVendorRequestWithDb: vi.fn(async () => SESSION),
}));
vi.mock("@/lib/logger", () => ({
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
}));

import { query } from "@/lib/db";
import { verifyVendorRequestWithDb } from "@/lib/identity/vendor-auth-with-db";
import { GET } from "./route";

function getReq(url = "http://localhost/api/v1/vendor/orders"): Request {
  return new Request(url, { method: "GET" });
}

describe("GET /api/v1/vendor/orders", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: every un-mocked query returns an empty result so
    // the route never NPEs on rows[0].
    vi.mocked(query).mockImplementation(async () => ({ rows: [] }) as never);
  });

  it("returns 401 when session is invalid", async () => {
    vi.mocked(verifyVendorRequestWithDb).mockResolvedValueOnce(null);
    const res = await GET(getReq() as never);
    expect(res.status).toBe(401);
  });

  it("pins vendor_id to session (IDOR defence)", async () => {
    vi.mocked(query).mockImplementation(async () => ({ rows: [] }) as never);
    await GET(getReq("http://localhost/api/v1/vendor/orders?vendorId=ATTACKER") as never);
    const calls = vi.mocked(query).mock.calls;
    // Every query must bind the SESSION vendor_id; never the URL param
    for (const call of calls) {
      expect(call[1]).toContain(SESSION.vendorId);
      expect(call[1]).not.toContain("ATTACKER");
    }
    // The WHERE clause must reference $1 = session.vendorId
    const selectCalls = calls.filter((c) =>
      String(c[0]).toUpperCase().includes("FROM VENDOR_ORDERS"),
    );
    expect(selectCalls.length).toBeGreaterThan(0);
    for (const c of selectCalls) {
      expect(String(c[0])).toMatch(/vendor_id\s*=\s*\$1/i);
    }
  });

  it("returns paginated response shape", async () => {
    vi.mocked(query)
      // SELECT orders
      .mockResolvedValueOnce({ rows: [ORDER_ROW] } as never)
      // COUNT
      .mockResolvedValueOnce({ rows: [{ total: "1" }] } as never)
      // status counts
      .mockResolvedValueOnce({
        rows: [
          { status: "pending", count: "1" },
          { status: "delivered", count: "3" },
        ],
      } as never);
    const res = await GET(
      getReq("http://localhost/api/v1/vendor/orders?page=1&limit=20") as never,
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({
      orders: [
        {
          id: "vo-1",
          orderNumber: "ORD-001",
          status: "pending",
          paymentStatus: "paid",
          itemsCount: 2,
          total: 110,
        },
      ],
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
      statusCounts: { pending: 1, delivered: 3 },
    });
  });

  it("status filter is bound (no SQL injection)", async () => {
    await GET(
      getReq(
        "http://localhost/api/v1/vendor/orders?status=pending' OR 1=1 --",
      ) as never,
    );
    const calls = vi.mocked(query).mock.calls;
    // The injected string must appear in a bound param, not in the SQL string
    const sqlBoundInjection = calls.find(
      (c) => String(c[0]).includes("' OR 1=1 --"),
    );
    expect(sqlBoundInjection).toBeUndefined();
    const paramBound = calls.find((c) =>
      String(c[1]).includes("' OR 1=1 --"),
    );
    expect(paramBound).toBeDefined();
  });

  it("search filter (order_number/customer_name/customer_phone)", async () => {
    await GET(
      getReq("http://localhost/api/v1/vendor/orders?search=محمد") as never,
    );
    const calls = vi.mocked(query).mock.calls;
    // Some call must include the search term in its bound params
    const paramCall = calls.find((c) => String(c[1]).includes("%محمد%"));
    expect(paramCall).toBeDefined();
    // And the SQL must use ILIKE (no manual quoting)
    const sqlCall = calls.find((c) =>
      String(c[0]).toLowerCase().includes("ilike"),
    );
    expect(sqlCall).toBeDefined();
  });

  it("date range filter binds startDate and endDate", async () => {
    await GET(
      getReq(
        "http://localhost/api/v1/vendor/orders?startDate=2026-01-01&endDate=2026-01-31",
      ) as never,
    );
    const calls = vi.mocked(query).mock.calls;
    const startCall = calls.find((c) => String(c[1]).includes("2026-01-01"));
    const endCall = calls.find((c) =>
      String(c[1]).includes("2026-01-31"),
    );
    expect(startCall).toBeDefined();
    expect(endCall).toBeDefined();
  });
});