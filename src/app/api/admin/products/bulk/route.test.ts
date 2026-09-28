import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Regression tests for POST /api/admin/products/bulk (admin vendor scope).
 *
 * Slice 4 says admin writes/deletes must only touch CITY_MARKETS_VENDOR_ID
 * rows. The bulk endpoint previously did not scope `DELETE
 * FROM vendor_products WHERE id = ANY($1)` (or any other action), so a
 * forged id vector could mutate other vendors' catalogs. These tests pin
 * every action to the same vendor scope.
 */

type QueryCall = { sql: string; params: unknown[] };

const calls: QueryCall[] = [];

vi.mock("@/lib/db", () => ({
  pool: { connect: vi.fn() },
  query: vi.fn(async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    const s = sql.trim().toUpperCase();
    if (s.startsWith("SELECT")) return { rows: [] };
    return { rowCount: 1 };
  }),
}));

vi.mock("@/lib/admin-api-auth", () => ({
  requireAdminApi: vi.fn().mockResolvedValue({
    admin: { id: "admin-1", permissions: ["manage_products"] },
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

import { query } from "@/lib/db";
import { POST } from "./route";
import type { NextRequest } from "next/server";
import { CITY_MARKETS_VENDOR_ID } from "@/lib/types";

function mockRequest(body: unknown): NextRequest {
  return {
    headers: { get: () => null },
    url: "http://localhost/api/admin/products/bulk",
    json: async () => body,
  } as unknown as NextRequest;
}

const IDS = [
  "00000000-0000-0000-0000-000000000aaa",
  "00000000-0000-0000-0000-000000000bbb",
];

describe("POST /api/admin/products/bulk — Slice 4 vendor scope", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    calls.length = 0;
  });

  it("delete scopes both SELECT and DELETE to CITY_MARKETS_VENDOR_ID", async () => {
    const req = mockRequest({ action: "delete", ids: IDS });
    await POST(req);

    const select = calls.find((c) =>
      c.sql.trim().toUpperCase().startsWith("SELECT"),
    );
    const del = calls.find((c) =>
      c.sql.trim().toUpperCase().startsWith("DELETE FROM VENDOR_PRODUCTS"),
    );

    expect(select).toBeDefined();
    expect(del).toBeDefined();
    // Both must include a vendor_id predicate.
    expect(select!.sql).toMatch(/VENDOR_ID\s*=\s*\$/i);
    expect(del!.sql).toMatch(/VENDOR_ID\s*=\s*\$/i);
    // City Markets vendor id is one of the bind parameters.
    expect(select!.params).toContain(CITY_MARKETS_VENDOR_ID);
    expect(del!.params).toContain(CITY_MARKETS_VENDOR_ID);
  });

  it("update_status scopes the UPDATE to CITY_MARKETS_VENDOR_ID", async () => {
    const req = mockRequest({ action: "update_status", ids: IDS, value: "active" });
    await POST(req);
    const upd = calls.find((c) =>
      c.sql.trim().toUpperCase().startsWith("UPDATE VENDOR_PRODUCTS"),
    );
    expect(upd).toBeDefined();
    expect(upd!.sql).toMatch(/VENDOR_ID\s*=\s*\$/i);
    expect(upd!.params).toContain(CITY_MARKETS_VENDOR_ID);
  });

  it("update_category scopes the UPDATE to CITY_MARKETS_VENDOR_ID", async () => {
    const req = mockRequest({
      action: "update_category",
      ids: IDS,
      value: "00000000-0000-0000-0000-000000000ccc",
    });
    await POST(req);
    const upd = calls.find((c) =>
      c.sql.trim().toUpperCase().startsWith("UPDATE VENDOR_PRODUCTS"),
    );
    expect(upd).toBeDefined();
    expect(upd!.sql).toMatch(/VENDOR_ID\s*=\s*\$/i);
    expect(upd!.params).toContain(CITY_MARKETS_VENDOR_ID);
  });

  it("update_quantity scopes the UPDATE to CITY_MARKETS_VENDOR_ID and targets stock_quantity", async () => {
    const req = mockRequest({ action: "update_quantity", ids: IDS, value: 7 });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const upd = calls.find((c) =>
      c.sql.trim().toUpperCase().startsWith("UPDATE VENDOR_PRODUCTS"),
    );
    expect(upd).toBeDefined();
    expect(upd!.sql).toMatch(/VENDOR_ID\s*=\s*\$/i);
    expect(upd!.params).toContain(CITY_MARKETS_VENDOR_ID);
    // Pin the live column — the legacy `products` table uses `stock_qty`
    // but vendor_products uses `stock_quantity`. A regression that hits
    // the wrong column would fail with a 500 at runtime.
    expect(upd!.sql.toUpperCase()).toMatch(/SET\s+STOCK_QUANTITY\s*=/);
    expect(upd!.sql.toUpperCase()).not.toMatch(/SET\s+STOCK_QTY\s*=/);
  });

  it("update_quantity rejects negative values", async () => {
    const req = mockRequest({ action: "update_quantity", ids: IDS, value: -1 });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("rejects empty id vectors with a 400 and no SQL", async () => {
    const req = mockRequest({ action: "delete", ids: [] });
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(calls.length).toBe(0);
  });

  it("rejects unsupported actions with a 400", async () => {
    const req = mockRequest({ action: "purge_universe", ids: IDS });
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(calls.length).toBe(0);
  });
});
