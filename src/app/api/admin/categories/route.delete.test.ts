import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Regression tests for DELETE /api/admin/categories — two new
 * destructive-action flags:
 *
 *   ?with_products=true  — cascade-delete every product in the category
 *                          (scoped to CITY_MARKETS_VENDOR_ID, with R2
 *                          cleanup).
 *   ?move_to=<uuid>      — re-parent every product to the target
 *                          category, then delete the source.
 *
 * Behaviour without either flag is preserved (409 if any products exist).
 */

type QueryCall = { sql: string; params: unknown[] };

const calls: QueryCall[] = [];
let capturedClientRelease = 0;
let capturedClientQueries: QueryCall[] = [];

const mockClient = {
  query: vi.fn(async (sql: string, params: unknown[] = []) => {
    capturedClientQueries.push({ sql, params });
    return { rowCount: 1, rows: [] };
  }),
  release: vi.fn(() => {
    capturedClientRelease++;
  }),
};

vi.mock("@/lib/db", () => ({
  pool: {
    connect: vi.fn(async () => mockClient),
  },
  query: vi.fn(async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    const s = sql.trim().toUpperCase();
    // Default SELECT result — return whatever row the handler asked for.
    if (s.startsWith("SELECT 1 FROM DESCENDANTS")) {
      return { rowCount: 0, rows: [] };
    }
    // Cycle-detection recursive query — no cycle.
    if (s.includes("WITH RECURSIVE DESCENDANTS")) {
      return { rowCount: 0, rows: [] };
    }
    if (s.startsWith("SELECT")) {
      // Two SELECTs to handle: source lookup (returns parent_id) and
      // product-count lookup (returns cnt).
      if (s.includes("FROM CATEGORIES WHERE ID")) {
        return { rowCount: 1, rows: [{ id: "src", parent_id: null }] };
      }
      if (s.includes("FROM PRODUCTS_UNIFIED WHERE CATEGORY_ID")) {
        return { rowCount: 1, rows: [{ cnt: 2 }] };
      }
      return { rowCount: 0, rows: [] };
    }
    return { rowCount: 1, rows: [] };
  }),
}));

vi.mock('@/lib/identity', () => ({
  requireAdminApi: vi.fn().mockResolvedValue({
    admin: { id: "admin-1", permissions: ["manage_categories"] },
  }),
}));

vi.mock("@/lib/r2", () => ({
  r2KeyFromUrl: vi.fn(() => null),
  deleteFromR2: vi.fn(async () => {}),
}));

vi.mock("@/lib/logger", () => ({
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
}));

import { DELETE } from "./route";
import type { NextRequest } from "next/server";
import { CITY_MARKETS_VENDOR_ID } from "@/lib/types";

const SRC_ID = "00000000-0000-0000-0000-000000000aaa";
const TGT_ID = "00000000-0000-0000-0000-000000000bbb";

function mockRequest(url: string): NextRequest {
  return {
    headers: { get: () => null },
    url,
    json: async () => ({}),
  } as unknown as NextRequest;
}

describe("DELETE /api/admin/categories — destructive options", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    calls.length = 0;
    capturedClientQueries = [];
    capturedClientRelease = 0;
  });

  it("default behaviour (no flag) refuses when products exist (409)", async () => {
    const res = await DELETE(
      mockRequest(`http://localhost/api/admin/categories?id=${SRC_ID}`),
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(String(body.error)).toMatch(/منتجات/);
    // No transaction should have been opened for the default 409.
    expect(capturedClientQueries.length).toBe(0);
  });

  it("with_products=true scopes vendor_products DELETE to CITY_MARKETS_VENDOR_ID inside a transaction", async () => {
    const res = await DELETE(
      mockRequest(
        `http://localhost/api/admin/categories?id=${SRC_ID}&with_products=true`,
      ),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.deletedProducts).toBe(2);

    // Vendor products cascade must be scoped.
    const vendorDelete = capturedClientQueries.find((c) =>
      c.sql.trim().toUpperCase().startsWith("DELETE FROM VENDOR_PRODUCTS"),
    );
    expect(vendorDelete).toBeDefined();
    expect(vendorDelete!.sql).toMatch(/VENDOR_ID\s*=\s*\$/i);
    expect(vendorDelete!.params).toContain(CITY_MARKETS_VENDOR_ID);

    // Categories cleanup must use a transaction.
    expect(capturedClientQueries.some((c) => /^BEGIN/i.test(c.sql.trim()))).toBe(
      true,
    );
    expect(capturedClientQueries.some((c) => /^COMMIT/i.test(c.sql.trim()))).toBe(
      true,
    );
    expect(capturedClientRelease).toBe(1);
  });

  it("move_to=<uuid> updates vendor_products.category_id scoped to CITY_MARKETS_VENDOR_ID", async () => {
    const res = await DELETE(
      mockRequest(
        `http://localhost/api/admin/categories?id=${SRC_ID}&move_to=${TGT_ID}`,
      ),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.movedProducts).toBe(2);

    const update = capturedClientQueries.find(
      (c) =>
        c.sql.trim().toUpperCase().startsWith("UPDATE VENDOR_PRODUCTS") &&
        c.sql.toUpperCase().includes("SET CATEGORY_ID"),
    );
    expect(update).toBeDefined();
    expect(update!.sql).toMatch(/VENDOR_ID\s*=\s*\$/i);
    expect(update!.params).toContain(CITY_MARKETS_VENDOR_ID);
    expect(update!.params).toContain(TGT_ID);
  });

  it("move_to with an invalid uuid is rejected with 400 (no SQL touched)", async () => {
    const res = await DELETE(
      mockRequest(
        `http://localhost/api/admin/categories?id=${SRC_ID}&move_to=not-a-uuid`,
      ),
    );
    expect(res.status).toBe(400);
    expect(capturedClientQueries.length).toBe(0);
  });

  it("move_to=self is rejected with 400", async () => {
    const res = await DELETE(
      mockRequest(
        `http://localhost/api/admin/categories?id=${SRC_ID}&move_to=${SRC_ID}`,
      ),
    );
    expect(res.status).toBe(400);
    expect(capturedClientQueries.length).toBe(0);
  });

  it("move_to pointing at a descendant is rejected with 400 (cycle guard)", async () => {
    // Replace the implementation wholesale so the recursive CTE query
    // returns a match (cycle detected) while the earlier lookups still
    // return rowCount 1.
    const { query } = await import("@/lib/db");
    const q = query as unknown as ReturnType<typeof vi.fn>;
    q.mockImplementation(
      async (sql: string, params: unknown[] = []) => {
        calls.push({ sql, params });
        const s = sql.trim().toUpperCase();
        if (s.includes("WITH RECURSIVE DESCENDANTS")) {
          return { rowCount: 1, rows: [{ "?column?": 1 }] };
        }
        if (s.startsWith("SELECT")) {
          if (s.includes("FROM CATEGORIES WHERE ID")) {
            return { rowCount: 1, rows: [{ id: "src", parent_id: null }] };
          }
          if (s.includes("FROM PRODUCTS_UNIFIED WHERE CATEGORY_ID")) {
            return { rowCount: 1, rows: [{ cnt: 2 }] };
          }
          return { rowCount: 0, rows: [] };
        }
        return { rowCount: 1, rows: [] };
      },
    );

    const res = await DELETE(
      mockRequest(
        `http://localhost/api/admin/categories?id=${SRC_ID}&move_to=${TGT_ID}`,
      ),
    );
    expect(res.status).toBe(400);
    expect(capturedClientQueries.length).toBe(0);
  });
});
