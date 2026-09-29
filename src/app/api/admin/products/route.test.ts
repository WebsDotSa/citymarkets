import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Regression tests for /api/admin/products (singular collection).
 *
 * Admin slice 4: the singular POST/PUT/DELETE handlers must always scope
 * writes/deletes to CITY_MARKETS_VENDOR_ID so the admin can never touch
 * another vendor's catalog. These tests pin that contract.
 */

type QueryCall = { sql: string; params: unknown[] };

const calls: QueryCall[] = [];

vi.mock("@/lib/db", () => ({
  pool: { connect: vi.fn() },
  query: vi.fn(async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    const s = sql.trim().toUpperCase();
    if (s.startsWith("SELECT COUNT(*)")) return { rows: [{ total: "0" }] };
    if (s.startsWith("SELECT")) return { rows: [] };
    if (s.startsWith("INSERT")) return { rows: [{ id: "00000000-0000-0000-0000-000000000001" }] };
    if (s.startsWith("UPDATE")) return { rowCount: 0 };
    if (s.startsWith("DELETE")) return { rowCount: 1 };
    return { rows: [] };
  }),
}));

vi.mock('@/lib/identity', () => ({
  requireAdminApi: vi.fn().mockResolvedValue({
    admin: { id: "admin-1", permissions: ["manage_products"] },
  }),
}));

vi.mock("@/lib/r2", () => ({
  r2KeyFromUrl: vi.fn((url: string) => (url?.startsWith("https://cdn.citymarkets.sa/") ? url.replace("https://cdn.citymarkets.sa/", "") : null)),
  deleteFromR2: vi.fn(async () => {}),
}));

vi.mock("@/lib/logger", () => ({
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
}));

import { query } from "@/lib/db";
import { DELETE, POST, PUT } from "./route";
import { r2KeyFromUrl, deleteFromR2 } from "@/lib/r2";
import type { NextRequest } from "next/server";
import { CITY_MARKETS_VENDOR_ID } from "@/lib/types";

function mockRequest(url: string, body?: unknown): NextRequest {
  return {
    headers: { get: () => null },
    url,
    json: body ? async () => body : undefined,
  } as unknown as NextRequest;
}

const VALID_UUID = "00000000-0000-0000-0000-000000000abc";

describe("/api/admin/products — Slice 4 vendor scope", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    calls.length = 0;
  });

  it("DELETE scopes the DELETE statement to CITY_MARKETS_VENDOR_ID", async () => {
    const req = mockRequest(
      `http://localhost/api/admin/products?id=${VALID_UUID}`,
    );
    await DELETE(req);
    const deleted = calls.find((c) =>
      c.sql.trim().toUpperCase().startsWith("DELETE FROM VENDOR_PRODUCTS"),
    );
    expect(deleted).toBeDefined();
    expect(deleted!.sql).toMatch(/VENDOR_ID\s*=\s*\$/i);
    // Last param must be the vendor id (last positional bind).
    const params = deleted!.params;
    expect(params[params.length - 1]).toBe(CITY_MARKETS_VENDOR_ID);
  });

  it("DELETE rejects non-UUID ids with 404", async () => {
    const req = mockRequest("http://localhost/api/admin/products?id=not-a-uuid");
    const res = await DELETE(req);
    expect(res.status).toBe(404);
    // No SQL DELETE should have been issued.
    const deleted = calls.find((c) =>
      c.sql.trim().toUpperCase().startsWith("DELETE"),
    );
    expect(deleted).toBeUndefined();
  });

  it("POST inserts with vendor_id = CITY_MARKETS_VENDOR_ID", async () => {
    const req = mockRequest("http://localhost/api/admin/products", {
      name_ar: "تفاح",
      category_id: "00000000-0000-0000-0000-000000000001",
      price: 10,
      stock_qty: 1,
    });
    await POST(req);
    const insert = calls.find((c) =>
      c.sql.trim().toUpperCase().startsWith("INSERT INTO VENDOR_PRODUCTS"),
    );
    expect(insert).toBeDefined();
    // First bind is vendor_id per the INSERT column list.
    expect(insert!.params[0]).toBe(CITY_MARKETS_VENDOR_ID);
  });

  it("PUT updates only within the City Markets vendor scope", async () => {
    const req = mockRequest(
      `http://localhost/api/admin/products?id=${VALID_UUID}`,
      {
        name_ar: "موز",
        category_id: "00000000-0000-0000-0000-000000000001",
        price: 12,
        stock_qty: 1,
      },
    );
    await PUT(req);
    const update = calls.find((c) =>
      c.sql.trim().toUpperCase().startsWith("UPDATE VENDOR_PRODUCTS"),
    );
    expect(update).toBeDefined();
    expect(update!.sql).toMatch(/VENDOR_ID\s*=\s*\$/i);
    const params = update!.params;
    expect(params[params.length - 1]).toBe(CITY_MARKETS_VENDOR_ID);
  });
});

describe("/api/admin/products — DELETE R2 cleanup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    calls.length = 0;
  });

  /**
   * Override the db mock for this block so the pre-DELETE SELECT
   * returns the row we want to clean up. The DELETE itself still
   * returns rowCount: 1.
   */
  function stubProductRow(row: { image_url: string | null; image_urls: string[] | null }) {
    (query as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      async (sql: string, params: unknown[] = []) => {
        calls.push({ sql, params });
        const s = sql.trim().toUpperCase();
        if (s.startsWith("SELECT IMAGE_URL")) return { rows: [row] };
        if (s.startsWith("DELETE")) return { rowCount: 1 };
        return { rows: [] };
      },
    );
  }

  it("cleans BOTH image_url (single) AND image_urls[] (gallery) from R2", async () => {
    stubProductRow({
      image_url: "https://cdn.citymarkets.sa/products/main-abc.jpg",
      image_urls: [
        "https://cdn.citymarkets.sa/products/gallery-1.jpg",
        "https://cdn.citymarkets.sa/products/gallery-2.jpg",
      ],
    });

    const req = mockRequest(`http://localhost/api/admin/products?id=${VALID_UUID}`);
    const res = await DELETE(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.deleted).toBe(1);
    // All 3 unique URLs should have triggered a deleteFromR2 call.
    expect(deleteFromR2).toHaveBeenCalledTimes(3);
    expect(deleteFromR2).toHaveBeenCalledWith("products/main-abc.jpg");
    expect(deleteFromR2).toHaveBeenCalledWith("products/gallery-1.jpg");
    expect(deleteFromR2).toHaveBeenCalledWith("products/gallery-2.jpg");
    expect(body.r2Cleaned).toBe(3);
    expect(body.r2Failed).toBe(0);
  });

  it("dedupes when the same image is used for main + gallery", async () => {
    stubProductRow({
      image_url: "https://cdn.citymarkets.sa/products/shared.jpg",
      image_urls: ["https://cdn.citymarkets.sa/products/shared.jpg"],
    });

    const req = mockRequest(`http://localhost/api/admin/products?id=${VALID_UUID}`);
    const res = await DELETE(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(deleteFromR2).toHaveBeenCalledTimes(1);
    expect(deleteFromR2).toHaveBeenCalledWith("products/shared.jpg");
    expect(body.r2Cleaned).toBe(1);
  });

  it("still cleans image_url when image_urls[] is empty", async () => {
    stubProductRow({
      image_url: "https://cdn.citymarkets.sa/products/only-main.jpg",
      image_urls: [],
    });

    const req = mockRequest(`http://localhost/api/admin/products?id=${VALID_UUID}`);
    const res = await DELETE(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(deleteFromR2).toHaveBeenCalledTimes(1);
    expect(deleteFromR2).toHaveBeenCalledWith("products/only-main.jpg");
    expect(body.r2Cleaned).toBe(1);
  });

  it("skips non-R2 URLs (vendor placeholders, external images) without 500", async () => {
    stubProductRow({
      image_url: "https://other-cdn.example.com/p.jpg",
      image_urls: ["https://cdn.citymarkets.sa/products/real.jpg"],
    });

    const req = mockRequest(`http://localhost/api/admin/products?id=${VALID_UUID}`);
    const res = await DELETE(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(deleteFromR2).toHaveBeenCalledTimes(1);
    expect(deleteFromR2).toHaveBeenCalledWith("products/real.jpg");
    expect(body.r2Cleaned).toBe(1);
  });

  it("reports r2Failed without failing the whole request when R2 throws", async () => {
    stubProductRow({
      image_url: "https://cdn.citymarkets.sa/products/will-fail.jpg",
      image_urls: ["https://cdn.citymarkets.sa/products/will-ok.jpg"],
    });
    (deleteFromR2 as unknown as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce(undefined);

    const req = mockRequest(`http://localhost/api/admin/products?id=${VALID_UUID}`);
    const res = await DELETE(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.r2Cleaned).toBe(1);
    expect(body.r2Failed).toBe(1);
    expect(body.r2Failures).toEqual(["products/will-fail.jpg"]);
  });
});
