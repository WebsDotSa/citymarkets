import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Regression test for GET /api/v1/categories.
 *
 * Public categories list. The route uses `query()` (no transactional
 * client) and a recursive CTE that reads product counts from
 * `products_unified` (migration 036, Slice 1).
 */

type QueryCall = { sql: string; params: unknown[] };

const calls: QueryCall[] = [];

vi.mock("@/lib/db", () => ({
  pool: { connect: vi.fn() },
  query: vi.fn(async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    if ((query as any).mockRows) return { rows: (query as any).mockRows };
    return { rows: [] };
  }),
}));

vi.mock("@/lib/cache", () => ({
  cache: {
    get: vi.fn().mockReturnValue(null),
    set: vi.fn(),
  },
  CACHE_TTL: { LONG: 3600 },
}));

vi.mock("@/lib/logger", () => ({
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
}));

import { query } from "@/lib/db";
import { GET } from "./route";

describe("GET /api/v1/categories — categories tree (regression)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    calls.length = 0;
    (query as any).mockRows = null;
  });

  it("returns an empty data array when no active categories exist", async () => {
    (query as any).mockRows = [];
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data).toEqual([]);
  });

  it("returns the populated category tree sourced from products_unified", async () => {
    (query as any).mockRows = [
      {
        id: "cat-1",
        name_ar: "ألبان",
        name_en: "Dairy",
        slug: "dairy",
        parent_id: null,
        sort_order: 1,
        is_active: true,
        description_ar: null,
        description_en: null,
        parent_slug: null,
        parent_name_ar: null,
        product_count: 12,
        descendant_count: 0,
        child_count: 3,
        icon_url: "/images/dairy.png",
      },
    ];
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(1);
    expect(body.data[0].slug).toBe("dairy");
    expect(body.data[0].product_count).toBe(12);

    // Migration target: the SQL must reference products_unified.
    const usesUnified = calls.some((c) =>
      /products_unified\b/i.test(c.sql)
    );
    expect(usesUnified).toBe(true);

    // Negative guarantee: bare `products` (without _unified) is forbidden.
    const usesBare = calls.some((c) =>
      /FROM\s+products\b(?!_unified)/i.test(c.sql) ||
      /JOIN\s+products\b(?!_unified)/i.test(c.sql)
    );
    expect(usesBare).toBe(false);
  });
});
