/**
 * HTTP route tests for GET/POST /api/v1/vendor/products.
 *
 * Invariants:
 *   1. GET: missing/invalid session → 401
 *   2. GET: vendor_id is PINNED to the session — the route never trusts
 *      a vendorId query param (IDOR defence; see also `vendorId` from body)
 *   3. GET: pagination (page/limit) and search filter are SQL-injected
 *      correctly (bound parameters)
 *   4. POST: requires role 'manager' or higher (owner/manager/staff passes,
 *      viewer denied)
 *   5. POST: vendor_id is PINNED to session — body vendorId is ignored
 *   6. POST: missing nameAr or price → 400
 *   7. POST: archived (is_active=false) categoryId → 400
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const SESSION = {
  vendorId: "00000000-0000-0000-0000-0000000000a1",
  vendorSlug: "burger-palace",
  staffId: "staff-1",
  email: "owner@example.com",
  fullName: "Owner",
  role: "owner" as const,
  permissions: [],
};

const PRODUCT_ROW = {
  id: "p-1",
  name_ar: "برجر",
  name_en: "Burger",
  description_ar: "لحم بقري",
  description_en: "Beef",
  image_urls: ["https://x/1.jpg"],
  price: "25.00",
  discount_price: null,
  sku: "BURG-1",
  stock_quantity: 50,
  track_stock: true,
  is_active: true,
  sort_order: 0,
  category_id: null,
  metadata: {},
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

vi.mock("@/lib/db", () => ({
  query: vi.fn(),
  pool: {
    connect: vi.fn(),
    query: vi.fn(async () => ({ rows: [] })),
  },
}));
vi.mock("@/lib/identity", () => ({
  verifyVendorRequestWithDb: vi.fn(async () => SESSION),
  requireVendorRole: vi.fn((_session: unknown, role: string) => {
    // owner + manager allowed; staff/viewer denied for "manager"
    const s = _session as { role: string };
    if (role === "manager" && (s.role === "owner" || s.role === "manager")) {
      return null;
    }
    return new Response(JSON.stringify({ error: "forbidden" }), {
      status: 403,
      headers: { "content-type": "application/json" },
    });
  }),
  signVendorSessionToken: vi.fn(async () => "jwt.vendor.test"),
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
import { GET, POST } from "./route";

function getReq(url = "http://localhost/api/v1/vendor/products"): Request {
  return new Request(url, { method: "GET" });
}

function postJson(body: unknown): Request {
  return new Request("http://localhost/api/v1/vendor/products", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("GET /api/v1/vendor/products", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: every un-mocked query call returns an empty result.
    vi.mocked(query).mockImplementation(async () => ({ rows: [] }) as never);
  });

  it("returns 401 when session is invalid", async () => {
    vi.mocked(verifyVendorRequestWithDb).mockResolvedValueOnce(null);
    const res = await GET(getReq() as never);
    expect(res.status).toBe(401);
  });

  it("pins vendor_id to the session — never reads it from the URL", async () => {
    vi.mocked(query)
      // 1st: SELECT products
      .mockResolvedValueOnce({ rows: [PRODUCT_ROW] } as never)
      // 2nd: SELECT COUNT
      .mockResolvedValueOnce({ rows: [{ total: "1" }] } as never);

    const res = await GET(
      getReq("http://localhost/api/v1/vendor/products?vendorId=ATTACKER") as never,
    );
    expect(res.status).toBe(200);
    // The vendorId from the URL must NOT appear in any bound param.
    const calls = vi.mocked(query).mock.calls;
    for (const call of calls) {
      expect(call[1]).not.toContain("ATTACKER");
      // vendor_id is pinned to SESSION.vendorId
      expect(call[1]).toContain(SESSION.vendorId);
    }
  });

  it("search filter is bound (no SQL injection)", async () => {
    vi.mocked(query)
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockResolvedValueOnce({ rows: [{ total: "0" }] } as never);
    await GET(
      getReq("http://localhost/api/v1/vendor/products?search=' OR 1=1") as never,
    );
    const calls = vi.mocked(query).mock.calls;
    const searchCall = calls.find((c) =>
      String(c[1]).includes("' OR 1=1"),
    );
    expect(searchCall).toBeDefined();
  });

  it("returns paginated response shape", async () => {
    vi.mocked(query)
      .mockResolvedValueOnce({ rows: [PRODUCT_ROW] } as never)
      .mockResolvedValueOnce({ rows: [{ total: "1" }] } as never);
    const res = await GET(
      getReq("http://localhost/api/v1/vendor/products?page=1&limit=20") as never,
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({
      products: [
        {
          id: "p-1",
          name: "برجر",
          nameEn: "Burger",
          isActive: true,
        },
      ],
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });
  });
});

describe("POST /api/v1/vendor/products", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(query).mockImplementation(async () => ({ rows: [] }) as never);
  });

  it("returns 401 when session is invalid", async () => {
    vi.mocked(verifyVendorRequestWithDb).mockResolvedValueOnce(null);
    const res = await POST(postJson({ nameAr: "x", price: 10 }) as never);
    expect(res.status).toBe(401);
  });

  it("denies 'viewer' role (cannot create products)", async () => {
    vi.mocked(verifyVendorRequestWithDb).mockResolvedValueOnce({
      ...SESSION,
      role: "viewer",
    });
    const res = await POST(postJson({ nameAr: "x", price: 10 }) as never);
    expect(res.status).toBe(403);
  });

  it("returns 400 when nameAr is missing", async () => {
    const res = await POST(postJson({ price: 25 }) as never);
    expect(res.status).toBe(400);
  });

  it("returns 400 when price is missing", async () => {
    const res = await POST(postJson({ nameAr: "برجر" }) as never);
    expect(res.status).toBe(400);
  });

  it("pins vendor_id to session — ignores vendorId in body (IDOR defence)", async () => {
    vi.mocked(query).mockResolvedValueOnce({ rows: [PRODUCT_ROW] } as never);
    await POST(
      postJson({
        nameAr: "برجر",
        price: 25,
        vendorId: "ATTACKER-VENDOR",
      }) as never,
    );
    const insertCall = vi.mocked(query).mock.calls.find(
      (c) => typeof c[0] === "string" && c[0].toUpperCase().startsWith("INSERT"),
    );
    expect(insertCall).toBeDefined();
    // Session vendor_id is in the params, attacker's vendorId is NOT
    expect(insertCall![1]).toContain(SESSION.vendorId);
    expect(insertCall![1]).not.toContain("ATTACKER-VENDOR");
  });

  it("rejects archived categoryId (is_active=false) with 400", async () => {
    // default implementation already returns {rows: []} → category is archived
    const res = await POST(
      postJson({
        nameAr: "برجر",
        price: 25,
        categoryId: "archived-cat",
      }) as never,
    );
    expect(res.status).toBe(400);
  });

  it("creates product with active categoryId", async () => {
    vi.mocked(query)
      .mockResolvedValueOnce({ rows: [{ id: "cat-1" }] } as never)
      .mockResolvedValueOnce({ rows: [PRODUCT_ROW] } as never);
    const res = await POST(
      postJson({
        nameAr: "برجر",
        price: 25,
        categoryId: "cat-1",
      }) as never,
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.product).toMatchObject({ id: "p-1", name: "برجر" });
  });
});