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
  (query as any).mockHandler = null;
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
    (query as any).mockHandler = async (sql: string) => {
      // SQL spans multiple lines — `s` flag lets `.` match \n.
      if (/SELECT id, name_ar[\s\S]*FROM categories/i.test(sql)) return { rows };
      return { rows: [] };
    };
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
    (query as any).mockHandler = async (sql: string, params: unknown[] = []) => {
      if (sql.startsWith("SELECT id FROM categories")) return { rows: [] };
      if (sql.startsWith("INSERT INTO categories")) {
        insertParams = params;
        return { rows: [{ id: "new-cat-id" }] };
      }
      return { rows: [] };
    };
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
    (query as any).mockHandler = async (sql: string, params: unknown[] = []) => {
      if (sql.startsWith("SELECT id FROM categories")) return { rows: [] };
      if (sql.startsWith("INSERT INTO categories")) {
        insertParams = params;
        return { rows: [{ id: "global-id" }] };
      }
      return { rows: [] };
    };
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

  it("scopes the slug uniqueness check to the vendor's private scope", async () => {
    let privateCheckParams: unknown[] | null = null;
    (query as any).mockHandler = async (sql: string, params: unknown[] = []) => {
      if (/SELECT id FROM categories WHERE vendor_id = \$1 AND slug = \$2/.test(sql)) {
        privateCheckParams = params;
        return { rows: [] };
      }
      if (sql.startsWith("INSERT INTO categories")) {
        return { rows: [{ id: "id" }] };
      }
      return { rows: [] };
    };
    const res = await POST(
      makeRequest({ nameAr: "قهوة", slug: "my-qahwa" }) as unknown as never,
    );
    expect(res.status).toBe(200);
    // The scope check must include `vendor_id = $1` so the same slug
    // can exist under another vendor (partial uniques).
    expect(privateCheckParams).toEqual(["v1", "my-qahwa"]);
  });

  it("scopes the slug uniqueness check to global scope when isPrivate=false", async () => {
    let globalCheckParams: unknown[] | null = null;
    (query as any).mockHandler = async (sql: string, params: unknown[] = []) => {
      if (/SELECT id FROM categories WHERE vendor_id IS NULL AND slug = \$1/.test(sql)) {
        globalCheckParams = params;
        return { rows: [] };
      }
      if (sql.startsWith("INSERT INTO categories")) {
        return { rows: [{ id: "id" }] };
      }
      return { rows: [] };
    };
    const res = await POST(
      makeRequest({ nameAr: "قهوة", slug: "my-qahwa", isPrivate: false }) as unknown as never,
    );
    expect(res.status).toBe(200);
    expect(globalCheckParams).toEqual(["my-qahwa"]);
  });

  it("appends a numeric suffix when the vendor's slug is already taken", async () => {
    let slugChecks = 0;
    (query as any).mockHandler = async (sql: string) => {
      if (/SELECT id FROM categories WHERE vendor_id = \$1 AND slug/.test(sql)) {
        slugChecks++;
        // First check (base) returns a row (taken); subsequent checks free.
        return slugChecks === 1 ? { rows: [{ id: "other" }] } : { rows: [] };
      }
      if (sql.startsWith("INSERT INTO categories")) {
        return { rows: [{ id: "id" }] };
      }
      return { rows: [] };
    };
    const res = await POST(
      makeRequest({ nameAr: "قهوة" }) as unknown as never,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    // generateSlug("قهوة") → "qhwah" per the transliteration table; the
    // unique-suffix loop must append "-2" verbatim, not trim the base.
    expect(body.data.slug).toBe("qhwah-2");
  });

  it("busts the storefront cache on private POST", async () => {
    (query as any).mockHandler = async (sql: string) => {
      if (sql.startsWith("SELECT id FROM categories")) return { rows: [] };
      if (sql.startsWith("INSERT INTO categories")) return { rows: [{ id: "id" }] };
      return { rows: [] };
    };
    await POST(makeRequest({ nameAr: "قهوة" }) as unknown as never);
    expect(vi.mocked(cache.invalidatePattern)).toHaveBeenCalledWith(
      "vendor-storefront:acme:categories:",
    );
    // Private POST must NOT bust the public categories cache.
    expect(vi.mocked(cache.invalidatePattern)).not.toHaveBeenCalledWith("categories:");
  });

  it("busts the public categories cache too on global POST", async () => {
    (query as any).mockHandler = async (sql: string) => {
      if (sql.startsWith("SELECT id FROM categories")) return { rows: [] };
      if (sql.startsWith("INSERT INTO categories")) return { rows: [{ id: "id" }] };
      return { rows: [] };
    };
    await POST(
      makeRequest({ nameAr: "قهوة", isPrivate: false }) as unknown as never,
    );
    expect(vi.mocked(cache.invalidatePattern)).toHaveBeenCalledWith("categories:");
  });
});
