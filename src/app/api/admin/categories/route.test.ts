import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Regression test for GET /api/admin/categories.
 *
 * The GET handler was migrated from the legacy `products` table to
 * `products_unified` in two subqueries: a COUNT(*) subquery and a
 * LATERAL subquery that picks the effective icon image. This test
 * asserts both are sourced from `products_unified` and never from
 * bare `products`.
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
    admin: { id: "admin-1", permissions: ["manage_categories"] },
  }),
}));

import { GET } from "./route";

function mockRequest(url: string): Request {
  return { headers: { get: () => null }, url } as unknown as Request;
}

describe("GET /api/admin/categories — products_unified migration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    calls.length = 0;
  });

  it("uses products_unified for both subqueries and never bare products", async () => {
    await GET(mockRequest("http://localhost/api/admin/categories") as never);

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
