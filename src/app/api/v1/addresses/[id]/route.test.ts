import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Regression tests for DELETE /api/v1/addresses/[id] (D11 fix).
 *
 * Pre-fix: profile-new.tsx called this endpoint via path-param but
 * the only DELETE handler lived on /api/v1/addresses with a `?id=`
 * query param. The fetch either 400'd or silently no-op'd. Today the
 * route is its own file with the path-param shape.
 *
 * P2-3: the route delegates to the address service instead of
 * inlining the DELETE. The SQL is still exercised here via the
 * @/lib/db mock so we keep the regression on "id + user_id in WHERE".
 */

type QueryCall = { sql: string; params: unknown[] };

const calls: QueryCall[] = [];

vi.mock("@/lib/db", () => ({
  pool: { connect: vi.fn() },
  query: vi.fn(async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    if ((query as any).mockRows) {
      return { rows: (query as any).mockRows, rowCount: (query as any).mockRowCount ?? (query as any).mockRows.length };
    }
    return { rows: [], rowCount: (query as any).mockRowCount ?? 0 };
  }),
}));

vi.mock("@/lib/identity", () => ({
  resolveCustomerUserIdFromRequest: vi.fn(),
}));

vi.mock("@/lib/logger", () => ({
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
}));

import { query } from "@/lib/db";
import { resolveCustomerUserIdFromRequest } from "@/lib/identity";
import { DELETE } from "./route";
import type { NextRequest } from "next/server";

function mockRequest(url = "http://localhost/api/v1/addresses/abc"): NextRequest {
  return {
    headers: { get: () => null },
    url,
  } as unknown as NextRequest;
}

const PARAMS = (id: string) => Promise.resolve({ id });

describe("DELETE /api/v1/addresses/[id] (D11)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    calls.length = 0;
    (query as any).mockRows = null;
    (query as any).mockRowCount = 0;
  });

  it("returns 401 when no customer is resolved", async () => {
    vi.mocked(resolveCustomerUserIdFromRequest).mockResolvedValue(null);
    const res = await DELETE(mockRequest() as never, { params: PARAMS("addr-1") });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toBe("غير مصرح");
    expect(calls).toHaveLength(0);
  });

  it("returns 404 when the address row doesn't exist or belongs to another user", async () => {
    vi.mocked(resolveCustomerUserIdFromRequest).mockResolvedValue("user-1");
    (query as any).mockRowCount = 0;
    const res = await DELETE(mockRequest() as never, { params: PARAMS("addr-1") });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toBe("العنوان غير موجود");
  });

  it("deletes the address and returns 200 when rowCount=1", async () => {
    vi.mocked(resolveCustomerUserIdFromRequest).mockResolvedValue("user-1");
    (query as any).mockRowCount = 1;
    (query as any).mockRows = [{ id: "addr-1" }];
    const res = await DELETE(mockRequest() as never, { params: PARAMS("addr-1") });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);

    // The service pins both id AND user_id in the WHERE clause so a
    // customer can't delete another customer's row with a guessed UUID.
    // The service interpolates param positions ($1=userId, $2=id).
    const sql = calls[0].sql;
    expect(sql).toMatch(/DELETE FROM addresses/);
    expect(sql).toMatch(/user_id = \$1::uuid/);
    expect(sql).toMatch(/id = \$2::uuid/);
    expect(calls[0].params).toEqual(["user-1", "addr-1"]);
  });

  it("returns 500 on DB error", async () => {
    vi.mocked(resolveCustomerUserIdFromRequest).mockResolvedValue("user-1");
    vi.mocked(query).mockRejectedValueOnce(new Error("db_down"));
    const res = await DELETE(mockRequest() as never, { params: PARAMS("addr-1") });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toBe("فشل حذف العنوان");
  });
});
