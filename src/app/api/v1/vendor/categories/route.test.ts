import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

/**
 * Tests for /api/v1/vendor/categories.
 *
 * Mocks `verifyVendorRequestWithDb` + `requireVendorRole` so the auth
 * branches can be exercised without a real vendor JWT. The DB calls
 * route through a stubbed `query()` that records each call so we can
 * assert the unique-slug loop and the INSERT shape.
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

vi.mock("@/lib/vendor-auth", () => ({
  verifyVendorRequestWithDb: vi.fn(async () => mockSession),
  requireVendorRole: vi.fn(() => mockRoleForbidden),
}));

import { query } from "@/lib/db";
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

  it("returns the category list from the global table", async () => {
    const rows = [
      { id: "c1", name_ar: "ألبان", name_en: "Dairy", slug: "dairy", parent_id: null, sort_order: 1, is_active: true },
      { id: "c2", name_ar: "فواكه", name_en: "Fruit", slug: "fruit", parent_id: null, sort_order: 2, is_active: true },
    ];
    (query as any).mockHandler = async (sql: string) => {
      if (sql.startsWith("SELECT id, name_ar")) return { rows };
      return { rows: [] };
    };
    const res = await GET(makeRequest() as unknown as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(2);
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

  it("inserts with a derived slug and returns the new id", async () => {
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
    // generateSlug on Arabic names produces a hyphen-separated Latin
    // string — assert the shape rather than the exact bytes (the
    // transliteration table may evolve).
    expect(typeof body.data.slug).toBe("string");
    expect(body.data.slug.length).toBeGreaterThan(0);
    expect(body.data.slug).toMatch(/^[a-z0-9-]+$/);
    expect(insertParams?.[0]).toBe("تمور فاخرة");
    expect(insertParams?.[1]).toBe("Premium Dates");
  });

  it("appends a numeric suffix when the slug is already taken", async () => {
    let slugChecks = 0;
    (query as any).mockHandler = async (sql: string) => {
      if (sql.startsWith("SELECT id FROM categories")) {
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
});
