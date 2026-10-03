import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Unit tests for GET /api/admin/users — PCP-167 (Phase 16 backend).
 *
 * Verifies:
 *   - The `WHERE deleted_at IS NULL` clause is present in the SELECT.
 *   - The `COUNT(*)` query also filters by `deleted_at IS NULL`.
 *   - The route does not leak soft-deleted users in the response.
 */

type QueryCall = { sql: string; params: unknown[] };
const calls: QueryCall[] = [];

vi.mock("@/lib/db", () => ({
  pool: { connect: vi.fn() },
  query: vi.fn(async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    return { rows: [], rowCount: 0 };
  }),
}));

const requireAdminApi = vi.fn();
vi.mock("@/lib/identity", () => ({}));
vi.mock("@/lib/identity/admin-api-auth-db", () => ({
  requireAdminApi: (...args: unknown[]) => requireAdminApi(...args),
}));

vi.mock("@/lib/logger", () => ({
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
}));

import { GET } from "./route";

function mockRequest(url: string): NextRequest {
  return { headers: { get: () => null }, url } as unknown as NextRequest;
}

describe("GET /api/admin/users — PCP-167 soft-delete filter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    calls.length = 0;
    requireAdminApi.mockResolvedValue({
      admin: { id: "admin-1", permissions: ["manage_users"] },
    });
  });

  it("includes `WHERE deleted_at IS NULL` in the SELECT query", async () => {
    await GET(mockRequest("http://x/api/admin/users"));
    const dataCall = calls.find((c) => /FROM\s+users/i.test(c.sql) && /LIMIT/i.test(c.sql));
    expect(dataCall).toBeDefined();
    expect(dataCall!.sql).toMatch(/deleted_at\s+IS\s+NULL/i);
  });

  it("includes `WHERE deleted_at IS NULL` in the COUNT query", async () => {
    await GET(mockRequest("http://x/api/admin/users"));
    const countCall = calls.find((c) => /COUNT\(\*\)/i.test(c.sql));
    expect(countCall).toBeDefined();
    expect(countCall!.sql).toMatch(/deleted_at\s+IS\s+NULL/i);
  });

  it("does NOT query the users table without the soft-delete filter", async () => {
    await GET(mockRequest("http://x/api/admin/users"));
    for (const c of calls) {
      if (/FROM\s+users/i.test(c.sql)) {
        expect(c.sql).toMatch(/deleted_at\s+IS\s+NULL/i);
      }
    }
  });

  it("returns 401-equivalent NextResponse when RBAC fails", async () => {
    const denied = NextResponse.json({ error: "no auth" }, { status: 401 });
    requireAdminApi.mockResolvedValueOnce(denied);
    const res = await GET(mockRequest("http://x/api/admin/users"));
    expect(calls.length).toBe(0);
    expect(res).toBe(denied);
  });
});
