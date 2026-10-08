import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

/**
 * Tests for /api/v1/vendor/categories/[id] (PATCH + DELETE).
 *
 * Security model under test:
 *   - 404 (not 403) when a vendor tries to mutate another vendor's
 *     private category, so they cannot probe for foreign IDs.
 *   - PATCH is manager+; DELETE is owner-only.
 *   - Slug immutability — the route never updates `slug`.
 */

type QueryCall = { sql: string; params: unknown[] };
const calls: QueryCall[] = [];

vi.mock("@/lib/db", () => ({
  pool: { connect: vi.fn() },
  query: vi.fn(async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    if ((query as any).mockHandler) {
      return await (query as any).mockHandler(sql, params);
    }
    return { rows: [] };
  }),
}));

vi.mock("@/lib/cache", () => ({
  cache: {
    invalidatePattern: vi.fn(),
  },
}));

vi.mock("@/lib/logger", () => ({
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
}));

// --- Auth mock ---------------------------------------------------------
let mockSession:
  | { vendorId: string; vendorSlug: string; role: string; staffId: string }
  | null = { vendorId: "v1", vendorSlug: "acme", role: "manager", staffId: "s1" };
let mockRoleForbidden: NextResponse | null = null;

vi.mock("@/lib/identity/vendor-auth-with-db", () => ({
  verifyVendorRequestWithDb: vi.fn(async () => mockSession),
}));
vi.mock("@/lib/identity", () => ({
  requireVendorRole: vi.fn(() => mockRoleForbidden),
}));

import { query } from "@/lib/db";
import { cache } from "@/lib/cache";
import { PATCH, DELETE } from "./route";

function makeRequest(body: unknown, method = "PATCH"): Request {
  return new Request("http://localhost/api/v1/vendor/categories/cat-id", {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  calls.length = 0;
  mockSession = { vendorId: "v1", vendorSlug: "acme", role: "manager", staffId: "s1" };
  mockRoleForbidden = null;
  (query as any).mockHandler = null;
});

describe("PATCH /api/v1/vendor/categories/[id]", () => {
  it("returns 400 with the canonical envelope for a malformed UUID (PCP-112)", async () => {
    // Before the fix, a non-UUID id reached Postgres and crashed
    // with 22P02 → surfaced as 500. The guard short-circuits before
    // any SQL runs.
    const res = await PATCH(makeRequest({ nameAr: "توت" }) as unknown as never, {
      params: Promise.resolve({ id: "not-a-uuid" }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toBe("معرّف القسم غير صالح");
    // Guard short-circuits before the ownership SELECT.
    expect(calls.length).toBe(0);
  });

  it("returns 401 when no vendor session", async () => {
    mockSession = null;
    const res = await PATCH(makeRequest({ nameAr: "توت" }) as unknown as never, {
      params: Promise.resolve({ id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" }),
    });
    expect(res.status).toBe(401);
  });

  it("returns 403 when role is below manager", async () => {
    mockRoleForbidden = NextResponse.json({ error: "ممنوع" }, { status: 403 });
    const res = await PATCH(makeRequest({ nameAr: "توت" }) as unknown as never, {
      params: Promise.resolve({ id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" }),
    });
    expect(res.status).toBe(403);
  });

  it("returns 404 when the category belongs to another vendor", async () => {
    // Ownership query returns no rows — the route MUST 404, not 403.
    (query as any).mockHandler = async () => ({ rows: [] });
    const res = await PATCH(makeRequest({ nameAr: "توت" }) as unknown as never, {
      params: Promise.resolve({ id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb" }),
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toMatch(/القسم غير موجود/);
  });

  it("updates name_ar and name_en on a vendor-owned category", async () => {
    let updateParams: unknown[] | null = null;
    let updateSql = "";
    (query as any).mockHandler = async (sql: string, params: unknown[] = []) => {
      if (/SELECT id FROM categories WHERE id = \$1 AND vendor_id = \$2/.test(sql)) {
        return { rows: [{ id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" }] };
      }
      if (sql.startsWith("UPDATE categories")) {
        updateSql = sql;
        updateParams = params;
        return { rows: [] };
      }
      return { rows: [] };
    };
    const res = await PATCH(
      makeRequest({ nameAr: "توت طازج", nameEn: "Fresh Berries" }) as unknown as never,
      { params: Promise.resolve({ id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" }) },
    );
    expect(res.status).toBe(200);
    expect(updateSql).toMatch(/SET name_ar = \$1, name_en = \$2/);
    expect(updateSql).not.toMatch(/slug/);
    expect(updateParams).toEqual(["توت طازج", "Fresh Berries", "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"]);
  });

  it("updates only name_ar when nameEn is omitted", async () => {
    let updateSql = "";
    (query as any).mockHandler = async (sql: string) => {
      if (/SELECT id FROM categories/i.test(sql)) return { rows: [{ id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" }] };
      if (sql.startsWith("UPDATE categories")) {
        updateSql = sql;
        return { rows: [] };
      }
      return { rows: [] };
    };
    const res = await PATCH(
      makeRequest({ nameAr: "توت" }) as unknown as never,
      { params: Promise.resolve({ id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" }) },
    );
    expect(res.status).toBe(200);
    expect(updateSql).toMatch(/SET name_ar = \$1/);
    expect(updateSql).not.toMatch(/name_en/);
  });

  it("sets name_en to NULL when caller passes empty string", async () => {
    let updateParams: unknown[] | null = null;
    (query as any).mockHandler = async (sql: string, params: unknown[] = []) => {
      if (/SELECT id FROM categories/i.test(sql)) return { rows: [{ id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" }] };
      if (sql.startsWith("UPDATE categories")) {
        updateParams = params;
        return { rows: [] };
      }
      return { rows: [] };
    };
    const res = await PATCH(
      makeRequest({ nameAr: "توت", nameEn: "" }) as unknown as never,
      { params: Promise.resolve({ id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" }) },
    );
    expect(res.status).toBe(200);
    // Empty string → null in DB so the storefront fallback behaves.
    expect(updateParams?.[1]).toBeNull();
  });

  it("returns 400 when no updatable fields are provided", async () => {
    (query as any).mockHandler = async () => ({ rows: [{ id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" }] });
    const res = await PATCH(makeRequest({}) as unknown as never, {
      params: Promise.resolve({ id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/لا توجد بيانات/);
  });

  it("returns 400 when nameAr is provided but blank", async () => {
    const res = await PATCH(
      makeRequest({ nameAr: "   " }) as unknown as never,
      { params: Promise.resolve({ id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" }) },
    );
    expect(res.status).toBe(400);
  });

  it("busts the storefront cache after a successful rename", async () => {
    (query as any).mockHandler = async (sql: string) => {
      if (/SELECT id FROM categories/i.test(sql)) return { rows: [{ id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" }] };
      if (sql.startsWith("UPDATE categories")) return { rows: [] };
      return { rows: [] };
    };
    await PATCH(makeRequest({ nameAr: "توت" }) as unknown as never, {
      params: Promise.resolve({ id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" }),
    });
    expect(vi.mocked(cache.invalidatePattern)).toHaveBeenCalledWith(
      "vendor-storefront:acme:categories:",
    );
  });
});

describe("DELETE /api/v1/vendor/categories/[id]", () => {
  it("returns 401 when no vendor session", async () => {
    mockSession = null;
    const res = await DELETE(makeRequest({}, "DELETE") as unknown as never, {
      params: Promise.resolve({ id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" }),
    });
    expect(res.status).toBe(401);
  });

  it("returns 403 when role is below owner (manager tries to delete)", async () => {
    mockRoleForbidden = NextResponse.json({ error: "ممنوع" }, { status: 403 });
    const res = await DELETE(makeRequest({}, "DELETE") as unknown as never, {
      params: Promise.resolve({ id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" }),
    });
    expect(res.status).toBe(403);
  });

  it("returns 404 when the category belongs to another vendor", async () => {
    mockSession = { vendorId: "v1", vendorSlug: "acme", role: "owner", staffId: "s1" };
    (query as any).mockHandler = async () => ({ rows: [] });
    const res = await DELETE(makeRequest({}, "DELETE") as unknown as never, {
      params: Promise.resolve({ id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb" }),
    });
    expect(res.status).toBe(404);
  });

  it("deletes the category when the owner owns it", async () => {
    mockSession = { vendorId: "v1", vendorSlug: "acme", role: "owner", staffId: "s1" };
    let deleteCalled = false;
    (query as any).mockHandler = async (sql: string, params: unknown[] = []) => {
      if (/SELECT id FROM categories WHERE id = \$1 AND vendor_id = \$2/.test(sql)) {
        return { rows: [{ id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" }] };
      }
      if (sql === "DELETE FROM categories WHERE id = $1") {
        deleteCalled = true;
        expect(params[0]).toBe("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
        return { rows: [{ id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" }] };
      }
      return { rows: [] };
    };
    const res = await DELETE(makeRequest({}, "DELETE") as unknown as never, {
      params: Promise.resolve({ id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" }),
    });
    expect(res.status).toBe(200);
    expect(deleteCalled).toBe(true);
    expect(vi.mocked(cache.invalidatePattern)).toHaveBeenCalledWith(
      "vendor-storefront:acme:categories:",
    );
  });
});
