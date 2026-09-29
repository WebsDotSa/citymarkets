import { describe, it, expect, vi, beforeEach } from "vitest";

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
