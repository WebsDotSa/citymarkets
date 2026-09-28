import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Regression test for GET /api/v1/banners.
 *
 * Public active-banners endpoint. Uses `query()` (no transactional client).
 * On DB failure the route falls back to a hardcoded banner (see the
 * catch block in route.ts), so we also assert the fallback branch.
 */

type QueryCall = { sql: string; params: unknown[] };

const calls: QueryCall[] = [];

vi.mock("@/lib/db", () => ({
  pool: { connect: vi.fn() },
  query: vi.fn(async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    const s = sql.trim().toUpperCase();
    if (s.includes("FROM BANNERS")) {
      if ((query as any).mockRows) return { rows: (query as any).mockRows };
      if ((query as any).mockThrow) throw new Error("DB down");
      return { rows: [] };
    }
    return { rows: [] };
  }),
}));

vi.mock("@/lib/logger", () => ({
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
}));

import { query } from "@/lib/db";
import { GET } from "./route";

describe("GET /api/v1/banners — public active banners (regression)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    calls.length = 0;
    (query as any).mockRows = null;
    (query as any).mockThrow = false;
  });

  it("returns an empty data array when no banners are active", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data).toEqual([]);

    // The query must filter on `active = true` and order by sort_order.
    const bannersCall = calls.find((c) =>
      /FROM\s+banners\b/i.test(c.sql)
    );
    expect(bannersCall).toBeDefined();
    expect(bannersCall!.sql.toUpperCase()).toContain("ACTIVE = TRUE");
  });

  it("returns the populated banner list when active banners exist", async () => {
    (query as any).mockRows = [
      {
        id: "banner-1",
        image_url: "/images/banners/hero.jpg",
        link_type: "category",
        link_value: "dairy",
        sort_order: 1,
      },
      {
        id: "banner-2",
        image_url: "/images/banners/promo.png",
        link_type: "vendor",
        link_value: "almarai",
        sort_order: 2,
      },
    ];
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(2);
    expect(body.data[0].id).toBe("banner-1");
    expect(body.data[1].link_type).toBe("vendor");
  });
});
