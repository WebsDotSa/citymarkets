import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Unit tests for GET /api/admin/abandoned-carts.
 *
 * Verifies:
 *   - RBAC gate (manage_orders permission) is honoured.
 *   - WHERE clause sanitises `status` (rejects values outside the enum).
 *   - pagination is bounded (limit clamped to 100).
 *   - the SQL pulls from `abandoned_carts` and joins `users`.
 */

type QueryCall = { sql: string; params: unknown[] };
const calls: QueryCall[] = [];

vi.mock("@/lib/db", () => ({
  pool: { connect: vi.fn() },
  query: vi.fn(async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    return {
      rows: [
        {
          id: "snap-1",
          user_id: "user-1",
          guest_session_id: null,
          guest_name: "أحمد",
          guest_phone: "0501234567",
          items_count: 2,
          subtotal: 20,
          items: [{ product_id: "p-1", name_ar: "تمر", quantity: 2, unit_price: 10 }],
          intent_order_id: "order-99",
          status: "abandoned",
          recovered_order_id: null,
          last_seen_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
        },
      ],
      rowCount: 1,
    };
  }),
}));

const requireAdminApi = vi.fn();
vi.mock('@/lib/identity', () => ({  }));
vi.mock('@/lib/identity/admin-api-auth-db', () => ({ requireAdminApi: (...args: unknown[]) => requireAdminApi(...args), }));


vi.mock("@/lib/logger", () => ({
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
}));

import { GET } from "./route";

function mockRequest(url: string): NextRequest {
  return { headers: { get: () => null }, url } as unknown as NextRequest;
}

describe("GET /api/admin/abandoned-carts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    calls.length = 0;
    requireAdminApi.mockResolvedValue({
      admin: { id: "admin-1", permissions: ["manage_orders"] },
    });
  });

  it("returns 401-equivalent NextResponse when RBAC fails", async () => {
    const denied = NextResponse.json(
      { error: "no auth" },
      { status: 401 },
    );
    requireAdminApi.mockResolvedValueOnce(denied);
    const res = await GET(mockRequest("http://x/api/admin/abandoned-carts"));
    // The route must short-circuit on RBAC — no DB calls.
    expect(calls.length).toBe(0);
    expect(res).toBe(denied);
  });

  it("queries abandoned_carts with default page/limit", async () => {
    const res = await GET(
      mockRequest("http://x/api/admin/abandoned-carts"),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.pagination).toMatchObject({ page: 1, limit: 20 });

    // The list query should hit `abandoned_carts` and join users.
    // Match the SQL `COUNT(` function (not the `items_count` column).
    const listCall = calls.find((c) =>
      /FROM\s+abandoned_carts/i.test(c.sql) &&
      !/COUNT\s*\(/i.test(c.sql),
    );
    expect(listCall).toBeDefined();
    expect(listCall!.sql.toLowerCase()).toContain("join users");
    expect(listCall!.sql.toLowerCase()).toContain("limit");
    expect(listCall!.sql.toLowerCase()).toContain("offset");
  });

  it("clamps limit to 100 max", async () => {
    const res = await GET(
      mockRequest("http://x/api/admin/abandoned-carts?limit=9999"),
    );
    const body = await res.json();
    expect(body.pagination.limit).toBe(100);
  });

  it("ignores unknown status filter values (sanitised enum)", async () => {
    await GET(
      mockRequest(
        "http://x/api/admin/abandoned-carts?status=DROP_TABLE",
      ),
    );
    const listCall = calls.find((c) =>
      /FROM\s+abandoned_carts/i.test(c.sql) && !/COUNT\s*\(/i.test(c.sql),
    );
    expect(listCall).toBeDefined();
    // The unknown status must not leak into the SQL — no `ac.status = $1` clause.
    expect(listCall!.sql).not.toMatch(/ac\.status = \$1/);
  });

  it("applies the status filter when valid", async () => {
    await GET(
      mockRequest("http://x/api/admin/abandoned-carts?status=abandoned"),
    );
    const listCall = calls.find((c) =>
      /FROM\s+abandoned_carts/i.test(c.sql) && !/COUNT\s*\(/i.test(c.sql),
    );
    expect(listCall).toBeDefined();
    expect(listCall!.sql.toLowerCase()).toContain("ac.status = $1");
    expect(listCall!.params[0]).toBe("abandoned");
  });

  it("escapes the search filter with a parameterised ILIKE", async () => {
    await GET(
      mockRequest(
        "http://x/api/admin/abandoned-carts?search=05012'; DROP TABLE users;--",
      ),
    );
    const listCall = calls.find((c) =>
      /FROM\s+abandoned_carts/i.test(c.sql) && !/COUNT\s*\(/i.test(c.sql),
    );
    expect(listCall).toBeDefined();
    // Never concatenate the search string into the SQL.
    expect(listCall!.sql).not.toContain("DROP TABLE");
    expect(listCall!.params.some((p) => String(p).includes("05012"))).toBe(true);
  });
});
