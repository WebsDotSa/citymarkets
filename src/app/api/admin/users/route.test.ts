/**
 * HTTP route tests for /api/admin/users (PCP-145).
 *
 * Invariants covered:
 *   1. GET requires admin auth (401 otherwise).
 *   2. GET excludes soft-deleted users via `WHERE deleted_at IS NULL`
 *      on BOTH the data SELECT and the COUNT(*) (PCP-145 fix).
 *   3. DELETE anonymisation zeroes loyalty_points / loyalty_tier /
 *      spin_count_today (PCP-145 fix) — so historical tombstones can't
 *      surface in admin reports.
 *   4. DELETE is idempotent on already-soft-deleted users.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const ADMIN = { id: "admin-1", email: "admin@example.com", role: "admin" };

vi.mock("@/lib/db", () => {
  const query = vi.fn();
  const pool = {
    connect: vi.fn(),
    query: vi.fn(),
    release: vi.fn(),
  };
  // Default pool.connect returns a stub client so callers don't NPE.
  pool.connect.mockImplementation(async () => ({
    query: vi.fn(async () => ({ rows: [] })),
    release: vi.fn(),
  }));
  return { query, pool };
});
vi.mock("@/lib/identity/admin-api-auth-db", () => ({
  requireAdminApi: vi.fn(async () => ({ admin: ADMIN })),
}));
vi.mock("@/lib/admin-audit", () => ({
  logAdminAction: vi.fn(),
}));
vi.mock("@/lib/logger", () => ({
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
}));

import { query, pool } from "@/lib/db";
import { requireAdminApi } from "@/lib/identity/admin-api-auth-db";
import { GET, DELETE } from "./route";

function jsonRequest(url: string, method: string): Request {
  return new Request(url, { method });
}

describe("GET /api/admin/users", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAdminApi).mockResolvedValue({ admin: ADMIN } as never);
    vi.mocked(query).mockImplementation(async () => ({ rows: [] }) as never);
  });

  it("returns 401 when admin session is missing", async () => {
    const { NextResponse } = await import("next/server");
    vi.mocked(requireAdminApi).mockResolvedValueOnce(
      NextResponse.json({ success: false, error: "unauthorized" }, { status: 401 }) as never,
    );
    const res = await GET(
      jsonRequest("http://localhost/api/admin/users", "GET") as never,
    );
    expect(res.status).toBe(401);
  });

  it("PCP-145: SELECT filters out soft-deleted users (WHERE deleted_at IS NULL)", async () => {
    vi.mocked(query)
      .mockResolvedValueOnce({
        rows: [
          {
            id: "u-1",
            phone: "500000001",
            name: "Active",
            email: null,
            loyalty_points: 10,
            loyalty_tier: "silver",
            spin_count_today: 0,
            created_at: "2026-01-01",
          },
        ],
      } as never)
      .mockResolvedValueOnce({ rows: [{ total: 1 }] } as never);

    const res = await GET(
      jsonRequest("http://localhost/api/admin/users", "GET") as never,
    );
    expect(res.status).toBe(200);

    // Find the SELECT statement and assert it has the deleted_at filter.
    const calls = vi.mocked(query).mock.calls.map((c) => c[0] as string);
    const dataSelect = calls.find(
      (sql) => /SELECT[\s\S]+FROM\s+users/i.test(sql) && /LIMIT/.test(sql),
    );
    expect(dataSelect, "expected a paginated SELECT against users").toBeDefined();
    expect(dataSelect).toMatch(/WHERE\s+deleted_at\s+IS\s+NULL/i);

    // The COUNT query must also exclude tombstones.
    const countSelect = calls.find(
      (sql) => /COUNT\(\*\)/.test(sql) && !/LIMIT/.test(sql),
    );
    expect(countSelect, "expected a COUNT query").toBeDefined();
    expect(countSelect).toMatch(/WHERE\s+deleted_at\s+IS\s+NULL/i);
  });

  it("PCP-145: response `data` is the live SELECT result, `pagination.total` reflects the filtered count", async () => {
    vi.mocked(query)
      .mockResolvedValueOnce({
        rows: [{ id: "u-1", phone: "500000001", loyalty_tier: "silver" }],
      } as never)
      .mockResolvedValueOnce({ rows: [{ total: 1 }] } as never);

    const res = await GET(
      jsonRequest("http://localhost/api/admin/users", "GET") as never,
    );
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data).toEqual([
      { id: "u-1", phone: "500000001", loyalty_tier: "silver" },
    ]);
    expect(body.pagination.total).toBe(1);
  });
});

describe("DELETE /api/admin/users?id=...", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAdminApi).mockResolvedValue({ admin: ADMIN } as never);
  });

  it("returns 400 when id query param is missing", async () => {
    const res = await DELETE(
      jsonRequest("http://localhost/api/admin/users", "DELETE") as never,
    );
    expect(res.status).toBe(400);
  });

  it("PCP-145: anonymisation UPDATE zeroes loyalty_points / loyalty_tier / spin_count_today", async () => {
    const txQuery = vi.fn(async (sql: string) => {
      if (/SELECT[\s\S]+FROM\s+users\s+u\s+WHERE\s+u\.id/i.test(sql)) {
        return {
          rows: [
            {
              deleted_at: null,
              phone: "500000001",
              has_orders: "f",
            },
          ],
        };
      }
      return { rows: [] };
    });
    vi.mocked(pool.connect).mockImplementation(async () => ({
      query: txQuery,
      release: vi.fn(),
    }));

    const res = await DELETE(
      jsonRequest("http://localhost/api/admin/users?id=u-1", "DELETE") as never,
    );
    expect(res.status).toBe(200);

    // The anonymisation UPDATE must zero loyalty + spin fields so the
    // tombstone cannot leak through the GET listing once fix #1 lands.
    const updateCalls = txQuery.mock.calls
      .map((c) => c[0] as string)
      .filter((sql) => /^UPDATE\s+users\s+SET/i.test(sql));
    expect(updateCalls.length).toBeGreaterThanOrEqual(1);
    const anonymize = updateCalls.find((sql) => /deleted_at\s*=\s*NOW/i.test(sql));
    expect(anonymize, "expected an UPDATE users anonymising the row").toBeDefined();
    expect(anonymize).toMatch(/loyalty_points\s*=\s*0/);
    expect(anonymize).toMatch(/loyalty_tier\s*=\s*'bronze'/);
    expect(anonymize).toMatch(/spin_count_today\s*=\s*0/);
  });

  it("is idempotent on already-soft-deleted users (200, already_deleted=true)", async () => {
    const txQuery = vi.fn(async (sql: string) => {
      if (/SELECT[\s\S]+FROM\s+users\s+u\s+WHERE\s+u\.id/i.test(sql)) {
        return {
          rows: [
            {
              deleted_at: "2025-01-01T00:00:00Z",
              phone: "deleted-abcd1234",
              has_orders: "f",
            },
          ],
        };
      }
      return { rows: [] };
    });
    vi.mocked(pool.connect).mockImplementation(async () => ({
      query: txQuery,
      release: vi.fn(),
    }));

    const res = await DELETE(
      jsonRequest("http://localhost/api/admin/users?id=u-1", "DELETE") as never,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.already_deleted).toBe(true);

    // No anonymisation UPDATE may have fired.
    const updateCalls = txQuery.mock.calls
      .map((c) => c[0] as string)
      .filter((sql) => /^UPDATE\s+users\s+SET/i.test(sql));
    expect(updateCalls.length).toBe(0);
  });
});