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

vi.mock('@/lib/identity', () => ({
  requireAdminApi: vi.fn().mockResolvedValue({
    admin: { id: "admin-1", permissions: ["manage_products"] },
  }),
}))
vi.mock('@/lib/identity/admin-api-auth-db', () => ({
  requireAdminApi: vi.fn().mockResolvedValue({
    admin: { id: "admin-1", permissions: ["manage_products"] },
  }),
}));
;

import { GET } from "./route";

function mockRequest(url: string): Request {
  return { headers: { get: () => null }, url } as unknown as Request;
}

describe("GET /api/admin/products/[id] — products_unified migration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    calls.length = 0;
  });

  it("returns 400 with the canonical envelope for a malformed UUID", async () => {
    // PCP-112: before the fix this endpoint used an inline regex and
    // returned 404 "المنتج غير موجود" for a bad UUID. The audit
    // standardises on 400 "معرّف المنتج غير صالح" so the client sees
    // a validation error rather than a missing-resource error.
    const res = await GET(
      mockRequest("http://localhost/api/admin/products/not-a-uuid") as never,
      { params: Promise.resolve({ id: "not-a-uuid" }) } as never,
    );
    expect(res.status).toBe(400);
    const body = await (res as Response).json();
    expect(body.success).toBe(false);
    expect(body.error).toBe("معرّف المنتج غير صالح");
    // Guard must short-circuit BEFORE the pool is touched.
    expect(calls.length).toBe(0);
  });

  it("selects from products_unified and never from bare products", async () => {
    // Use a valid UUID so the route reaches its SQL query — non-UUID ids
    // 400 before the DB is touched.
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
