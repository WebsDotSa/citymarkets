import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Regression tests for POST /api/v1/addresses/[id]/default (D12 fix).
 *
 * Pre-fix: profile-new.tsx called this endpoint but the route did
 * not exist. The fetch 404'd and the toggle silently failed. Today
 * the route unsets every other default then sets `is_default=true`
 * on the target.
 */

type QueryCall = { sql: string; params: unknown[] };

const calls: QueryCall[] = [];

vi.mock("@/lib/db", () => ({
  pool: { connect: vi.fn() },
  query: vi.fn(async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    const q = query as unknown as { mockRowCount?: number };
    return { rows: [], rowCount: q.mockRowCount ?? 0 };
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
import { POST } from "./route";
import type { NextRequest } from "next/server";

function mockRequest(url = "http://localhost/api/v1/addresses/addr-1/default"): NextRequest {
  return {
    headers: { get: () => null },
    url,
  } as unknown as NextRequest;
}

const PARAMS = (id: string) => Promise.resolve({ id });

describe("POST /api/v1/addresses/[id]/default (D12)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    calls.length = 0;
    (query as unknown as { mockRowCount?: number }).mockRowCount = 0;
  });

  it("returns 401 when no customer is resolved", async () => {
    vi.mocked(resolveCustomerUserIdFromRequest).mockResolvedValue(null);
    const res = await POST(mockRequest() as never, { params: PARAMS("addr-1") });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toBe("غير مصرح");
    expect(calls).toHaveLength(0);
  });

  it("returns 404 when the address does not belong to the caller", async () => {
    vi.mocked(resolveCustomerUserIdFromRequest).mockResolvedValue("user-1");
    (query as unknown as { mockRowCount?: number }).mockRowCount = 0;
    const res = await POST(mockRequest() as never, { params: PARAMS("addr-1") });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toBe("العنوان غير موجود");
  });

  it("unsets other defaults then sets this one as default", async () => {
    vi.mocked(resolveCustomerUserIdFromRequest).mockResolvedValue("user-1");
    (query as unknown as { mockRowCount?: number }).mockRowCount = 1;
    const res = await POST(mockRequest() as never, { params: PARAMS("addr-1") });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);

    // First call: verify ownership
    expect(calls[0].sql).toMatch(/SELECT id FROM addresses/);
    expect(calls[0].sql).toMatch(/id = \$1::uuid AND user_id = \$2::uuid/);
    expect(calls[0].params).toEqual(["addr-1", "user-1"]);

    // Second call: unset other defaults — must filter id <> target
    // so the row we're about to promote doesn't get zeroed first.
    expect(calls[1].sql).toMatch(/SET is_default = false/);
    expect(calls[1].sql).toMatch(/id <> \$2::uuid/);
    expect(calls[1].params).toEqual(["user-1", "addr-1"]);

    // Third call: set this row default
    expect(calls[2].sql).toMatch(/SET is_default = true/);
    expect(calls[2].sql).toMatch(/id = \$1::uuid AND user_id = \$2::uuid/);
    expect(calls[2].params).toEqual(["addr-1", "user-1"]);
  });

  it("returns 500 on DB error during ownership check", async () => {
    vi.mocked(resolveCustomerUserIdFromRequest).mockResolvedValue("user-1");
    vi.mocked(query).mockRejectedValueOnce(new Error("db_down"));
    const res = await POST(mockRequest() as never, { params: PARAMS("addr-1") });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toBe("فشل تحديد العنوان الافتراضي");
  });

  it("does not touch defaults when 404 (skip the two UPDATEs)", async () => {
    vi.mocked(resolveCustomerUserIdFromRequest).mockResolvedValue("user-1");
    (query as unknown as { mockRowCount?: number }).mockRowCount = 0;
    await POST(mockRequest() as never, { params: PARAMS("addr-1") });
    // Only the ownership SELECT runs — no UPDATEs.
    expect(calls).toHaveLength(1);
    expect(calls[0].sql).toMatch(/SELECT/);
  });
});
