/**
 * Regression test for PCP-112 UUID guard on
 * /api/admin/categories/[id] GET.
 *
 * Background:
 *   Before this fix, the admin category detail endpoint only checked
 *   `!id` (truthy) before passing the value to Postgres. A bad UUID
 *   reached Postgres and crashed with 22P02, surfacing as a generic
 *   500 ("فشل جلب الفئة"). Mirrors the audit finding for the v1
 *   orders route — replace the null-check with the canonical
 *   validateUuidOrError helper so the 400 envelope is consistent
 *   with every other [id] route.
 *
 * Run with: npx vitest run src/app/api/admin/categories/[id]/route.test.ts
 */

import { describe, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";

const { mockRequireAdminApi } = vi.hoisted(() => ({
  mockRequireAdminApi: vi.fn().mockResolvedValue({
    admin: { id: "admin-1", email: "admin@citymarkets.sa", role: "super_admin" },
    isSuperAdmin: true,
  }),
}));
vi.mock("@/lib/identity/admin-api-auth-db", () => ({
  requireAdminApi: mockRequireAdminApi,
}));

const { mockQuery } = vi.hoisted(() => ({ mockQuery: vi.fn() }));
vi.mock("@/lib/db", () => ({
  pool: { query: vi.fn(), connect: vi.fn() },
  query: mockQuery,
}));

import { GET } from "./route";

function makeRequest(id: string): NextRequest {
  return new NextRequest(`http://localhost/api/admin/categories/${id}`, {
    method: "GET",
  });
}

describe("GET /api/admin/categories/[id] — PCP-112 UUID guard", () => {
  it("returns 400 with the canonical envelope for a malformed UUID", async () => {
    const res = await GET(makeRequest("not-a-uuid"), {
      params: Promise.resolve({ id: "not-a-uuid" }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toBe("معرّف الفئة غير صالح");
    // Critical: guard must short-circuit BEFORE the pool is touched.
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("returns 400 for an empty id segment", async () => {
    const res = await GET(makeRequest(""), {
      params: Promise.resolve({ id: "" }),
    });
    expect(res.status).toBe(400);
  });

  it("does not block a canonical UUID (handler reaches the pool)", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await GET(
      makeRequest("11111111-1111-1111-1111-111111111111"),
      {
        params: Promise.resolve({ id: "11111111-1111-1111-1111-111111111111" }),
      }
    );
    // 404 from the "row missing" path proves the guard let us through.
    expect(res.status).toBe(404);
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });
});
