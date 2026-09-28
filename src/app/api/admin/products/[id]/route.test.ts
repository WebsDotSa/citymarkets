import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Regression test for GET /api/admin/products/[id].
 *
 * The route was migrated from the legacy `products` table to the
 * `products_unified` view. This test asserts the captured SQL selects
 * FROM products_unified and never a bare `FROM products`.
 */

type QueryCall = { sql: string; params: unknown[] };

const calls: QueryCall[] = [];

vi.mock("@/lib/db", () => ({
  pool: { connect: vi.fn() },
  query: vi.fn(async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    return { rows: [] };
  }),
}));

vi.mock("@/lib/admin-api-auth", () => ({
  requireAdminApi: vi.fn().mockResolvedValue({
    admin: { id: "admin-1", permissions: ["manage_products"] },
  }),
}));

import { GET } from "./route";

function mockRequest(url: string): Request {
  return { headers: { get: () => null }, url } as unknown as Request;
}

describe("GET /api/admin/products/[id] — products_unified migration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    calls.length = 0;
  });

  it("selects from products_unified and never from bare products", async () => {
    // Use a valid UUID so the route reaches its SQL query — non-UUID ids
    // 404 before the DB is touched.
    await GET(
      mockRequest("http://localhost/api/admin/products/00000000-0000-0000-0000-000000000001") as never,
      { params: Promise.resolve({ id: "00000000-0000-0000-0000-000000000001" }) } as never,
    );

    const queriedProducts = calls.some(
      (c) =>
        c.sql.toUpperCase().match(/\bFROM\s+products\b(?!_)/i) ||
        c.sql.toUpperCase().match(/\bJOIN\s+products\b(?!_)/i),
    );
    expect(queriedProducts).toBe(false);

    // Match `FROM products_unified` regardless of the trailing alias
    // (the production query uses `FROM products_unified p` so a literal
    // word boundary after `products_unified` would never match).
    const usesUnified = calls.some(
      (c) =>
        c.sql.toUpperCase().match(/\bFROM\s+products_unified\b\s+\w/i) ||
        c.sql.toUpperCase().match(/\bJOIN\s+products_unified\b/i),
    );
    expect(usesUnified).toBe(true);
  });
});
