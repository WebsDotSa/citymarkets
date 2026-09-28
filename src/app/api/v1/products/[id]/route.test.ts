import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Regression test for GET /api/v1/products/[id].
 *
 * Verifies that the products-detail route has been fully migrated from
 * the legacy `products` table to the `products_unified` view. The
 * relevant migration is the fallback query (was `FROM products p`, now
 * `FROM products_unified p`). The route also fetches related products
 * and an active offer; both must NOT regress to bare `products`.
 *
 * The route uses `query` (not `pool.connect`) so we mock
 * `@/lib/db.query` to capture every SQL string the route issues
 * without running anything.
 */

type QueryCall = { sql: string; params: unknown[] };

function makeFakeQuery() {
  const calls: QueryCall[] = [];
  // The mocked `query` only needs to satisfy `.rows` for the route's
  // happy-path branches. The QueryResult shape is opaque here — we
  // cast through `unknown` so the route sees a structurally valid result
  // without forcing us to reproduce the full pg `QueryResult<T>` type.
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    const s = sql.trim().toUpperCase();

    // 1. First query — vendor_products (no rows returned so the route
    //    falls through to the products_unified fallback).
    if (s.includes("FROM VENDOR_PRODUCTS") && !s.includes("WHERE VENDOR_ID")) {
      return { rows: [] };
    }

    // 2. Fallback query — products_unified. Return a single legacy
    //    catalog row so the route renders the non-vendor branch
    //    (which issues the related-products query against
    //    products_unified).
    if (s.includes("FROM PRODUCTS_UNIFIED") && s.includes("WHERE P.ID = $1")) {
      return {
        rows: [
          {
            id: params[0],
            category_id: "cat-1",
            name_ar: "منتج قديم",
            name_en: "legacy product",
            barcode: "1234567890",
            description: "legacy catalog row",
            image_url: null,
            images: null,
            price: "9.99",
            discount_price: null,
            stock_qty: "5",
            unit: "pcs",
            is_featured: false,
            is_active: true,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            category_id_ref: "cat-1",
            category_name: "فئة",
            category_slug: "cat",
            category_icon: null,
          },
        ],
      };
    }

    // 3. Related-products query (also targets products_unified).
    if (s.includes("FROM PRODUCTS_UNIFIED") && s.includes("WHERE CATEGORY_ID = $1")) {
      return { rows: [] };
    }

    // 4. fetchActiveOffer — anything that touches offers/offer_targets
    //    returns empty so the route sees "no active offer" and skips
    //    effective-price computation.
    if (s.includes("FROM OFFERS") || s.includes("OFFER_TARGETS")) {
      return { rows: [] };
    }

    return { rows: [] };
  });
  return { query, calls };
}

vi.mock("@/lib/db", () => ({
  pool: { connect: vi.fn() },
  query: vi.fn(),
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

const PRODUCT_ID = "11111111-2222-3333-4444-555555555555";

describe("GET /api/v1/products/[id] — products_unified migration (regression)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("queries products_unified (not bare products) for product detail", async () => {
    const { query: q, calls } = makeFakeQuery();
    vi.mocked(query).mockImplementation(q as never);

    const res = await GET(
      mockRequest(`http://localhost/api/v1/products/${PRODUCT_ID}`),
      { params: Promise.resolve({ id: PRODUCT_ID }) }
    );

    // 200 — happy path: route found the legacy product.
    expect(res.status).toBe(200);

    // The migration target: at least one call must reference
    // `FROM products_unified` (the fallback detail query).
    const usesUnified = calls.some((c) =>
      /\bFROM\s+products_unified\b/i.test(c.sql)
    );
    expect(usesUnified).toBe(true);

    // Negative guarantee: no SQL string uses bare FROM/JOIN products
    // (i.e. without the `_unified` suffix).
    const usesBareProducts = calls.some((c) =>
      /\bFROM\s+products\b(?!_unified)/i.test(c.sql) ||
      /\bJOIN\s+products\b(?!_unified)/i.test(c.sql)
    );
    expect(usesBareProducts).toBe(false);
  });
});