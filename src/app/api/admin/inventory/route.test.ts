import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Regression test for GET /api/admin/inventory.
 *
 * The route was migrated from the legacy `products` table to the
 * `products_unified` view. This test asserts that BOTH inline SELECTs
 * (low-stock and out-of-stock) source from `products_unified` and
 * never reference bare `FROM products` or `JOIN products` (without the
 * `_unified` suffix).
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
}));

vi.mock("@/lib/app-settings", () => ({
  getInventorySettings: vi.fn().mockResolvedValue({ low_stock_threshold: 5 }),
  setAppSetting: vi.fn(),
}));

vi.mock("@/lib/admin-audit", () => ({
  logAdminAction: vi.fn(),
}));

vi.mock("@/lib/validation", () => ({
  inventorySettingsSchema: { safeParse: vi.fn() },
}));

import { GET } from "./route";

function mockRequest(url: string): Request {
  return { headers: { get: () => null }, url } as unknown as Request;
}

describe("GET /api/admin/inventory — products_unified migration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    calls.length = 0;
  });

  it("issues SELECTs against products_unified and never against bare products", async () => {
    await GET(mockRequest("http://localhost/api/admin/inventory") as never);

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
