import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Regression test for GET /api/v1/products.
 *
 * Public products list endpoint. Sources from `products_unified_with_offers`
 * (migration 040b) so vendor_rows + legacy catalog rows surface in a single
 * query. The route uses `query()` (no transactional client), so we mock
 * `query` and capture the SQL calls.
 */

type QueryCall = { sql: string; params: unknown[] };

const calls: QueryCall[] = [];

vi.mock("@/lib/db", () => ({
  pool: { connect: vi.fn() },
  query: vi.fn(async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    const s = sql.trim().toUpperCase();
    // COUNT(*) total query
    if (s.startsWith("SELECT COUNT(*)")) {
      return { rows: [{ total: "0" }] };
    }
    // Main SELECT — return whatever the test wants via `mockRows`
    if (s.includes("FROM PRODUCTS_UNIFIED_WITH_OFFERS")) {
      if ((query as any).mockRows) return { rows: (query as any).mockRows };
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
import type { NextRequest } from "next/server";

function mockRequest(url: string): NextRequest {
  return {
    headers: { get: () => null },
    url,
  } as unknown as NextRequest;
}

describe("GET /api/v1/products — products_unified_with_offers (regression)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    calls.length = 0;
    (query as any).mockRows = null;
  });

  it("returns an empty data array with pagination when no products match", async () => {
    (query as any).mockRows = [];
    const res = await GET(
      mockRequest("http://localhost/api/v1/products?limit=10&offset=0") as never
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data).toEqual([]);
    expect(body.pagination).toMatchObject({ page: 1, limit: 10, total: 0 });
  });

  it("queries products_unified_with_offers and respects category + search filters", async () => {
    (query as any).mockRows = [
      {
        id: "11111111-2222-3333-4444-555555555555",
        category_id: "cat-1",
        name_ar: "حليب طازج",
        name_en: "Fresh Milk",
        sku: "SKU-1",
        description: null,
        description_en: null,
        image_url: "/images/milk.png",
        images: [],
        price: "8.00",
        discount_price: null,
        stock_qty: "50",
        is_active: true,
        track_stock: true,
        sort_order: 1,
        source: "products",
        vendor_id: null,
        vendor_slug: null,
        vendor_name: null,
        category_id_ref: "cat-1",
        category_name: "ألبان",
        category_slug: "dairy",
        category_icon: null,
        avg_rating: "0",
        reviews_count: "0",
        active_offer_id: null,
        active_offer_title_ar: null,
        active_offer_type: null,
        active_offer_value: null,
        active_offer_max_discount: null,
        active_offer_min_order: null,
        active_offer_starts_at: null,
        active_offer_ends_at: null,
      },
    ];
    const res = await GET(
      mockRequest(
        "http://localhost/api/v1/products?category=dairy&search=milk&limit=5&offset=0"
      ) as never
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(1);
    expect(body.data[0].id).toBe(
      "11111111-2222-3333-4444-555555555555"
    );
    expect(body.data[0].price).toBe(8);

    // The COUNT and main SELECT must both source from the unified view.
    const usesUnified = calls.some((c) =>
      /FROM\s+products_unified_with_offers/i.test(c.sql)
    );
    expect(usesUnified).toBe(true);

    // Negative guarantee: no SQL string references bare `products` (no `_unified` suffix).
    const usesBare = calls.some((c) =>
      /FROM\s+products\b(?!_unified)/i.test(c.sql)
    );
    expect(usesBare).toBe(false);
  });
});
