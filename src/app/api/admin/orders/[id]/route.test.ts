/**
 * Regression test for the P2-9 UUID guard on
 * /api/admin/orders/[id] GET + PATCH.
 *
 * Background:
 *   Before this fix the admin order detail endpoint let
 *   `id = "bad-uuid"` reach Postgres, where it crashed with a 22P02
 *   "invalid input syntax for type uuid" and surfaced as a generic
 *   500 ("تعذر التحميل"). The PCP-101 audit noted the v1 route had
 *   the guard but admin didn't, and asked us to mirror it.
 *
 * This test pins the 400 response so the regression cannot return.
 *
 * Run with: npx vitest run src/app/api/admin/orders/[id]/route.test.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

// Mock the admin auth gate so we exercise only the UUID guard.
// The real gate returns `{admin: {...}, isSuperAdmin: true}` — match
// that shape so destructuring `gate.admin` works downstream.
// Use vi.hoisted so the factory can reference it after hoisting.
const { mockRequireAdminApi } = vi.hoisted(() => ({
  mockRequireAdminApi: vi.fn().mockResolvedValue({
    admin: { id: "admin-1", email: "admin@citymarkets.sa", role: "super_admin" },
    isSuperAdmin: true,
  }),
}));
vi.mock("@/lib/identity/admin-api-auth-db", () => ({
  requireAdminApi: mockRequireAdminApi,
}));

// Mock the pool so even if the UUID guard is bypassed (it shouldn't
// be), no real DB connection is opened during the test. Use vi.hoisted
// so the mock factory can reference the variable after vi.mock() is
// hoisted to the top of the file.
const { mockQuery } = vi.hoisted(() => ({ mockQuery: vi.fn() }));
vi.mock("@/lib/db", () => ({
  pool: { query: vi.fn(), connect: vi.fn() },
  query: mockQuery,
}));

// Mock the admin audit logger (PATCH handler logs on success).
vi.mock("@/lib/admin-audit", () => ({
  logAdminAction: vi.fn(),
}));

// Mock the loyalty release — irrelevant for the 400 path but imported.
vi.mock("@/lib/orders/loyalty", () => ({
  releaseRedeemHoldForOrder: vi.fn(),
}));

import { GET, PATCH } from "./route";

function makeRequest(method: "GET" | "PATCH", id: string, body?: unknown): NextRequest {
  return new NextRequest(`http://localhost/api/admin/orders/${id}`, {
    method,
    headers: body
      ? { "content-type": "application/json", "x-csrf-token": "test" }
      : { "x-csrf-token": "test" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

describe("/api/admin/orders/[id] — UUID guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: query() returns no rows (order not found).
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
    // Re-attach the admin gate mock (cleared by clearAllMocks).
    mockRequireAdminApi.mockResolvedValue({
      admin: { id: "admin-1", email: "admin@citymarkets.sa", role: "super_admin" },
      isSuperAdmin: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns 400 (not 500) for GET on a non-UUID id", async () => {
    const res = await GET(makeRequest("GET", "bad-uuid"), {
      params: Promise.resolve({ id: "bad-uuid" }),
    } as never);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.error).toMatch(/غير صالح/);
  });

  it("returns 400 (not 500) for PATCH on a non-UUID id", async () => {
    const res = await PATCH(
      makeRequest("PATCH", "bad-uuid", { status: "confirmed" }),
      { params: Promise.resolve({ id: "bad-uuid" }) } as never
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.error).toMatch(/غير صالح/);
  });

  it("rejects empty string id with 400 (no id param)", async () => {
    const res = await GET(makeRequest("GET", ""), {
      params: Promise.resolve({ id: "" }),
    } as never);
    // The middleware / route.ts ctx.params resolves to "" so the
    // UUID_RE.test("") returns false → 400.
    expect(res.status).toBe(400);
  });

  it("accepts a properly formatted UUID (returns 200/404 not 400)", async () => {
    const realId = "11111111-1111-1111-1111-111111111111";
    // Mocked query() returns empty rows → order not found → 404,
    // not 400. The key assertion is that the UUID guard did NOT
    // trigger.
    const res = await GET(makeRequest("GET", realId), {
      params: Promise.resolve({ id: realId }),
    } as never);
    expect([200, 404]).toContain(res.status);
    expect(res.status).not.toBe(400);
  });
});