import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Tests for /api/v1/vendors/[slug]/categories (public storefront).
 *
 * Verifies:
 *   - Returns 404 when the vendor doesn't exist or is inactive.
 *   - Returns both global categories (vendor_id IS NULL) and this
 *     vendor's private categories (vendor_id = $1).
 *   - NEVER returns another vendor's private categories.
 *   - Excludes inactive categories and inactive products.
 *   - Returns productCount per category.
 *   - Caches the payload under the documented key.
 */

type QueryCall = { sql: string; params: unknown[] };
const calls: QueryCall[] = [];

vi.mock("@/lib/db", () => ({
  pool: { connect: vi.fn() },
  query: vi.fn(async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    if ((query as any).mockHandler) {
      return await (query as any).mockHandler(sql, params);
    }
    return { rows: [] };
  }),
}));

vi.mock("@/lib/cache", () => ({
  cache: {
    get: vi.fn().mockReturnValue(null),
    set: vi.fn(),
    invalidatePattern: vi.fn(),
  },
}));

vi.mock("@/lib/logger", () => ({
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
}));

import { query } from "@/lib/db";
import { cache } from "@/lib/cache";
import { GET } from "./route";

function makeRequest(): Request {
  return new Request("http://localhost/api/v1/vendors/acme/categories", {
    method: "GET",
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  calls.length = 0;
  (query as any).mockHandler = null;
  vi.mocked(cache.get).mockReturnValue(null);
});

describe("GET /api/v1/vendors/[slug]/categories", () => {
  it("returns 404 when the vendor doesn't exist", async () => {
    (query as any).mockHandler = async (sql: string) => {
      if (/SELECT id FROM vendors/i.test(sql)) return { rows: [] };
      return { rows: [] };
    };
    const res = await GET(makeRequest() as unknown as never, {
      params: Promise.resolve({ slug: "ghost" }),
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toMatch(/غير موجود/);
  });

  it("returns 404 when the vendor is inactive", async () => {
    // The SQL filters with `is_active = TRUE`, so an inactive vendor
    // produces zero rows. The route must translate that to 404.
    (query as any).mockHandler = async () => ({ rows: [] });
    const res = await GET(makeRequest() as unknown as never, {
      params: Promise.resolve({ slug: "sleeping" }),
    });
    expect(res.status).toBe(404);
  });

  it("returns global + this vendor's private categories with product counts", async () => {
    (query as any).mockHandler = async (sql: string) => {
      if (/SELECT id FROM vendors/i.test(sql)) return { rows: [{ id: "v1" }] };
      if (/FROM categories c/i.test(sql)) {
        return {
          rows: [
            {
              id: "g1",
              name_ar: "ألبان",
              name_en: "Dairy",
              slug: "dairy",
              icon_url: null,
              vendor_id: null,
              sort_order: 1,
              product_count: "4",
            },
            {
              id: "p1",
              name_ar: "تمور خاصة",
              name_en: "Private Dates",
              slug: "private-dates",
              icon_url: null,
              vendor_id: "v1",
              sort_order: 5,
              product_count: "2",
            },
          ],
        };
      }
      return { rows: [] };
    };
    const res = await GET(makeRequest() as unknown as never, {
      params: Promise.resolve({ slug: "acme" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.categories).toHaveLength(2);

    const dairy = body.data.categories.find((c: { id: string }) => c.id === "g1");
    expect(dairy.is_private).toBe(false);
    expect(dairy.product_count).toBe(4);

    const p1 = body.data.categories.find((c: { id: string }) => c.id === "p1");
    expect(p1.is_private).toBe(true);
    expect(p1.product_count).toBe(2);
  });

  it("excludes another vendor's private categories", async () => {
    // We assert at the SQL level: the JOIN must filter on
    //   (c.vendor_id IS NULL OR c.vendor_id = $1)
    // so a different vendor's private rows never reach the response.
    (query as any).mockHandler = async (sql: string) => {
      if (/SELECT id FROM vendors/i.test(sql)) return { rows: [{ id: "v1" }] };
      if (/FROM categories c/i.test(sql)) {
        return { rows: [] };
      }
      return { rows: [] };
    };
    await GET(makeRequest() as unknown as never, {
      params: Promise.resolve({ slug: "acme" }),
    });
    const catsQuery = calls.find((c) => /FROM categories c/i.test(c.sql));
    expect(catsQuery?.sql).toMatch(/c\.vendor_id IS NULL OR c\.vendor_id = \$1/);
    expect(catsQuery?.params[0]).toBe("v1");
  });

  it("scopes the join to vendor_products.vendor_id = $1", async () => {
    // The storefront must NOT show another vendor's product count
    // under a global category. We assert the vendor-id filter on
    // vendor_products is present in the JOIN.
    (query as any).mockHandler = async (sql: string) => {
      if (/SELECT id FROM vendors/i.test(sql)) return { rows: [{ id: "v1" }] };
      if (/FROM categories c/i.test(sql)) return { rows: [] };
      return { rows: [] };
    };
    await GET(makeRequest() as unknown as never, {
      params: Promise.resolve({ slug: "acme" }),
    });
    const catsQuery = calls.find((c) => /FROM categories c/i.test(c.sql));
    expect(catsQuery?.sql).toMatch(/vp\.vendor_id = \$1/);
  });

  it("filters out inactive categories and inactive products", async () => {
    (query as any).mockHandler = async (sql: string) => {
      if (/SELECT id FROM vendors/i.test(sql)) return { rows: [{ id: "v1" }] };
      if (/FROM categories c/i.test(sql)) return { rows: [] };
      return { rows: [] };
    };
    await GET(makeRequest() as unknown as never, {
      params: Promise.resolve({ slug: "acme" }),
    });
    const catsQuery = calls.find((c) => /FROM categories c/i.test(c.sql));
    expect(catsQuery?.sql).toMatch(/c\.is_active = TRUE/);
    expect(catsQuery?.sql).toMatch(/vp\.is_active = TRUE/);
  });

  it("serves the cached payload on warm cache", async () => {
    const cached = {
      categories: [
        {
          id: "g1",
          name_ar: "ألبان",
          name_en: null,
          slug: "dairy",
          icon_url: null,
          is_private: false,
          product_count: 1,
          sort_order: 0,
        },
      ],
    };
    vi.mocked(cache.get).mockReturnValueOnce(cached as never);
    const res = await GET(makeRequest() as unknown as never, {
      params: Promise.resolve({ slug: "acme" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual(cached);
    expect(body.cached).toBe(true);
    // No DB hit on a cache hit.
    expect(calls).toHaveLength(0);
  });

  it("stores the response under the documented cache key on a cold read", async () => {
    (query as any).mockHandler = async (sql: string) => {
      if (/SELECT id FROM vendors/i.test(sql)) return { rows: [{ id: "v1" }] };
      if (/FROM categories c/i.test(sql)) return { rows: [] };
      return { rows: [] };
    };
    await GET(makeRequest() as unknown as never, {
      params: Promise.resolve({ slug: "acme" }),
    });
    expect(vi.mocked(cache.set)).toHaveBeenCalledWith(
      "vendor-storefront:acme:categories:v1",
      expect.objectContaining({ categories: expect.any(Array) }),
      60_000,
    );
  });

  it("parses product_count as integer (PG returns text for COUNT)", async () => {
    (query as any).mockHandler = async (sql: string) => {
      if (/SELECT id FROM vendors/i.test(sql)) return { rows: [{ id: "v1" }] };
      if (/FROM categories c/i.test(sql)) {
        return {
          rows: [
            {
              id: "g1",
              name_ar: "ألبان",
              name_en: null,
              slug: "dairy",
              icon_url: null,
              vendor_id: null,
              sort_order: 1,
              product_count: "12",
            },
          ],
        };
      }
      return { rows: [] };
    };
    const res = await GET(makeRequest() as unknown as never, {
      params: Promise.resolve({ slug: "acme" }),
    });
    const body = await res.json();
    expect(typeof body.data.categories[0].product_count).toBe("number");
    expect(body.data.categories[0].product_count).toBe(12);
  });
});
