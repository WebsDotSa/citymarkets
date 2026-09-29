import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Regression test for GET /api/admin/driver/orders/[id].
 *
 * The items subquery was migrated from the legacy `products` table to
 * `products_unified`. This test asserts the captured SQL includes
 * `JOIN products_unified` and never a bare `JOIN products`.
 */

type QueryCall = { sql: string; params: unknown[] };

const calls: QueryCall[] = [];

vi.mock("@/lib/db", () => ({
  pool: {
    connect: vi.fn(),
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      return { rows: [] };
    }),
  },
  query: vi.fn(),
}));

vi.mock('@/lib/identity', () => ({
  requireAdminApi: vi.fn().mockResolvedValue({
    admin: { id: "admin-1", permissions: ["view_delivery_orders"] },
  }),
}));
vi.mock('@/lib/identity/admin-api-auth-db', () => ({
  requireAdminApi: vi.fn().mockResolvedValue({
    admin: { id: "admin-1", permissions: ["view_delivery_orders"] },
  }),
}));

import { GET } from "./route";

function mockRequest(url: string): Request {
  return { headers: { get: () => null }, url } as unknown as Request;
}

describe("GET /api/admin/driver/orders/[id] — products_unified migration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    calls.length = 0;
  });

  it("joins order_items to products_unified and never to bare products", async () => {
    await GET(
      mockRequest("http://localhost/api/admin/driver/orders/uuid-1") as never,
      { params: Promise.resolve({ id: "uuid-1" }) } as never,
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
