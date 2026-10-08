import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

/**
 * Tests for /api/v1/vendor/categories.
 *
 * Mocks `verifyVendorRequestWithDb` + `requireVendorRole` so the auth
 * branches can be exercised without a real vendor JWT. The DB calls
 * route through a stubbed `query()` that records each call so we can
 * assert the unique-slug loop, the vendor_id scoping, and the
 * {global, private} response shape.
 */

// `vi.hoisted` runs before everything else (including `vi.mock`
// factory hoisting). The shared `calls` array + handler indirection
// live here so the @/lib/db factory can read them without referring
// to any test-file-level `const`/`let` (which would be TDZ at
// hoisting time).
const { calls, getHandler, setHandler } = vi.hoisted(() => {
  const calls: { sql: string; params: unknown[] }[] = [];
  type QueryHandler = (sql: string, params: unknown[]) => unknown;
  type GlobalWithHandler = { __categoriesTestHandler?: QueryHandler | null };
  const getHandler = (): QueryHandler | null =>
    (globalThis as GlobalWithHandler).__categoriesTestHandler ?? null;
  const setHandler = (h: QueryHandler | null): void => {
    (globalThis as GlobalWithHandler).__categoriesTestHandler = h;
  };
  (globalThis as GlobalWithHandler).__categoriesTestHandler = null;
  return { calls, getHandler, setHandler };
});

vi.mock("@/lib/db", () => {
  const makeQueryMock = () =>
    vi.fn(async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      const handler = getHandler();
      if (handler) {
        return await handler(sql, params);
      }
      return { rows: [] };
    });
  return {
    pool: { connect: vi.fn(), query: makeQueryMock() },
    query: makeQueryMock(),
  };
});

vi.mock("@/lib/cache", () => ({
  cache: {
    get: vi.fn().mockReturnValue(null),
    set: vi.fn(),
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

vi.mock('@/lib/identity/vendor-auth-with-db', () => ({
  verifyVendorRequestWithDb: vi.fn(async () => mockSession),
}));
vi.mock('@/lib/identity', () => ({
  requireVendorRole: vi.fn(() => mockRoleForbidden),
}));

import { query } from "@/lib/db";
import { cache } from "@/lib/cache";
import { GET, POST } from "./route";

function makeRequest(body?: unknown): Request {
  return new Request("http://localhost/api/v1/vendor/categories", {
    method: body ? "POST" : "GET",
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  calls.length = 0;
  mockSession = { vendorId: "v1", vendorSlug: "acme", role: "manager", staffId: "s1" };
  mockRoleForbidden = null;
  setHandler(null);
});

describe("GET /api/v1/vendor/categories", () => {
  it("returns 401 when no vendor session", async () => {
    mockSession = null;
    const res = await GET(makeRequest() as unknown as never);
    expect(res.status).toBe(401);
  });

  it("returns {global, private} split from a single scoped query", async () => {
    const rows = [
      { id: "g1", name_ar: "ألبان", name_en: "Dairy", slug: "dairy", parent_id: null, sort_order: 1, is_active: true, vendor_id: null },
      { id: "g2", name_ar: "فواكه", name_en: "Fruit", slug: "fruit", parent_id: null, sort_order: 2, is_active: true, vendor_id: null },
      { id: "p1", name_ar: "تمور", name_en: "Dates", slug: "dates", parent_id: null, sort_order: 0, is_active: true, vendor_id: "v1" },
    ];
    setHandler(async (sql: string) => {
      // SQL spans multiple lines — `s` flag lets `.` match \n.
      if (/SELECT id, name_ar[\s\S]*FROM categories/i.test(sql)) return { rows };
      return { rows: [] };
    });
    const res = await GET(makeRequest() as unknown as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.global).toHaveLength(2);
    expect(body.data.private).toHaveLength(1);
    expect(body.data.private[0].id).toBe("p1");
    expect(body.data.private[0].vendor_id).toBe("v1");
    // The query must scope by `vendor_id IS NULL OR vendor_id = $1`
    // so other vendors' private rows never leak through.
    const scoped = calls.find((c) => /FROM categories/i.test(c.sql));
    expect(scoped?.sql).toMatch(/vendor_id IS NULL OR vendor_id = \$1/);
    expect(scoped?.params[0]).toBe("v1");
  });

  it("serves the cached payload on second call", async () => {
    const cached = { global: [], private: [{ id: "p1", name_ar: "x", vendor_id: "v1" }] };
    vi.mocked(cache.get).mockReturnValueOnce(cached as never);
    const res = await GET(makeRequest() as unknown as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual(cached);
    // No DB hit when cache is warm.
    expect(calls).toHaveLength(0);
  });
});

describe("POST /api/v1/vendor/categories", () => {
  it("returns 401 when no vendor session", async () => {
    mockSession = null;
    const res = await POST(makeRequest({ nameAr: "قهوة" }) as unknown as never);
    expect(res.status).toBe(401);
  });

  it("returns 403 when role is below manager", async () => {
    mockRoleForbidden = NextResponse.json({ error: "ممنوع" }, { status: 403 });
    const res = await POST(makeRequest({ nameAr: "قهوة" }) as unknown as never);
    expect(res.status).toBe(403);
  });

  it("returns 400 when name is missing", async () => {
    const res = await POST(makeRequest({}) as unknown as never);
    expect(res.status).toBe(400);
  });

  it("creates a PRIVATE row by default (vendor_id = current)", async () => {
    let insertParams: unknown[] | null = null;
    setHandler(async (sql: string, params: unknown[] = []) => {
      if (sql.startsWith("INSERT INTO categories")) {
        insertParams = params;
        return { rows: [{ id: "new-cat-id" }] };
      }
      return { rows: [] };
    });
    const res = await POST(
      makeRequest({ nameAr: "تمور فاخرة", nameEn: "Premium Dates" }) as unknown as never,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.id).toBe("new-cat-id");
    expect(body.data.isPrivate).toBe(true);
    expect(body.data.vendor_id).toBe("v1");
    expect(insertParams?.[0]).toBe("تمور فاخرة");
    expect(insertParams?.[1]).toBe("Premium Dates");
    // The vendor_id is the LAST param when private.
    expect(insertParams?.[3]).toBe("v1");
  });

  it("creates a GLOBAL row when isPrivate=false (vendor_id NULL)", async () => {
    let insertParams: unknown[] | null = null;
    setHandler(async (sql: string, params: unknown[] = []) => {
      if (sql.startsWith("INSERT INTO categories")) {
        insertParams = params;
        return { rows: [{ id: "global-id" }] };
      }
      return { rows: [] };
    });
    const res = await POST(
      makeRequest({ nameAr: "قهوة", isPrivate: false }) as unknown as never,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.isPrivate).toBe(false);
    expect(body.data.vendor_id).toBeNull();
    // Global insert has only 3 params: name_ar, name_en, slug (no vendor_id).
    expect(insertParams).toHaveLength(3);
  });

  it("inserts with the supplied slug verbatim when free (no SELECT probe)", async () => {
    // SECURITY (PCP-149): the old code did a SELECT-before-INSERT
    // round-trip; the new path skips it and lets the partial unique
    // index do the work. Only one INSERT should be issued when the
    // slug is free.
    let insertCount = 0;
    setHandler(async (sql: string) => {
      if (sql.startsWith("INSERT INTO categories")) {
        insertCount++;
        return { rows: [{ id: "id" }] };
      }
      return { rows: [] };
    });
    const res = await POST(
      makeRequest({ nameAr: "قهوة", slug: "my-qahwa" }) as unknown as never,
    );
    expect(res.status).toBe(200);
    expect(insertCount).toBe(1);
  });

  it("retries the INSERT with a numeric suffix on pg 23505 (unique_violation)", async () => {
    // SECURITY (PCP-149): when the base slug is taken, the INSERT
    // throws pg code 23505 and the route appends "-2" and retries
    // instead of doing a SELECT loop. At most MAX_SLUG_RETRIES=5
    // attempts total.
    let insertCount = 0;
    setHandler(async (sql: string, params: unknown[] = []) => {
      if (sql.startsWith("INSERT INTO categories")) {
        insertCount++;
        if (insertCount === 1) {
          // Simulate the partial unique index rejecting the slug.
          const err: any = new Error("duplicate key value violates unique constraint");
          err.code = "23505";
          throw err;
        }
        return { rows: [{ id: "id" }] };
      }
      return { rows: [] };
    });
    const res = await POST(
      makeRequest({ nameAr: "قهوة" }) as unknown as never,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    // generateSlug("قهوة") → "qhwah"; on 23505 the route appends "-2".
    expect(body.data.slug).toBe("qhwah-2");
    // Exactly two attempts: the rejected base slug + the successful "-2".
    expect(insertCount).toBe(2);
  });

  it("returns 409 when every retry attempt collides", async () => {
    // SECURITY (PCP-149): 5 attempts exhausted — surface a 409 so the
    // client picks a different slug instead of silently 200ing.
    setHandler(async (sql: string) => {
      if (sql.startsWith("INSERT INTO categories")) {
        const err: any = new Error("duplicate key value violates unique constraint");
        err.code = "23505";
        throw err;
      }
      return { rows: [] };
    });
    const res = await POST(
      makeRequest({ nameAr: "قهوة" }) as unknown as never,
    );
    expect(res.status).toBe(409);
  });

  it("rethrows non-23505 errors (does not swallow DB faults)", async () => {
    // SECURITY (PCP-149): only 23505 should be caught. A 23502 (not_null)
    // or 23503 (fk_violation) or 08006 (connection) must propagate so
    // the global error handler can log + 500 — not be turned into a
    // silent 409 by the retry loop.
    setHandler(async (sql: string) => {
      if (sql.startsWith("INSERT INTO categories")) {
        const err: any = new Error("connection lost");
        err.code = "08006";
        throw err;
      }
      return { rows: [] };
    });
    const res = await POST(
      makeRequest({ nameAr: "قهوة" }) as unknown as never,
    );
    // The route's outer try/catch logs and returns a 500-class
    // response, never a 2xx success. We accept anything that is not
    // 200/409 to keep the test resilient to error-shaping changes,
    // while still proving the error was NOT swallowed into a
    // successful retry path.
    expect(res.status).not.toBe(200);
    expect(res.status).not.toBe(409);
  });

  it("busts the storefront cache on private POST", async () => {
    setHandler(async (sql: string) => {
      if (sql.startsWith("INSERT INTO categories")) return { rows: [{ id: "id" }] };
      return { rows: [] };
    });
    await POST(makeRequest({ nameAr: "قهوة" }) as unknown as never);
    expect(vi.mocked(cache.invalidatePattern)).toHaveBeenCalledWith(
      "vendor-storefront:acme:categories:",
    );
    // Private POST must NOT bust the public categories cache.
    expect(vi.mocked(cache.invalidatePattern)).not.toHaveBeenCalledWith("categories:");
  });

  it("busts the public categories cache too on global POST", async () => {
    setHandler(async (sql: string) => {
      if (sql.startsWith("INSERT INTO categories")) return { rows: [{ id: "id" }] };
      return { rows: [] };
    });
    await POST(
      makeRequest({ nameAr: "قهوة", isPrivate: false }) as unknown as never,
    );
    expect(vi.mocked(cache.invalidatePattern)).toHaveBeenCalledWith("categories:");
  });
});
