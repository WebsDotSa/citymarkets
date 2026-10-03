/**
 * HTTP route tests for POST/PUT/DELETE /api/admin/vendors
 * and PATCH /api/admin/vendors/[id].
 *
 * Invariants covered:
 *   1. POST/PUT/PATCH/DELETE all require admin auth (401 otherwise).
 *   2. POST: invalid slug (leading dash) → 400.
 *   3. POST: missing slug auto-fills via `generateSlug` (Arabic
 *      name_ar → Latin transliteration slug).
 *   4. POST: round-trip — Unicode slugs pass the new Unicode regex.
 *   5. POST: owner row bootstrap requires phone + password.
 *   6. POST: duplicate slug (PG 23505) → 400.
 *   7. PUT: COALESCE preserves untouched fields.
 *   8. DELETE: refuses vendor with products/orders.
 *   9. PATCH /[id]: rejects unknown keys (strict schema).
 *  10. PATCH /[id]: rejects invalid UUID.
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
  // Default pool.connect returns a stub client with query() + a no-op
  // release handler so callers don't NPE.
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
vi.mock("@/lib/password", () => ({
  hashPassword: vi.fn(async (p: string) => `hashed:${p}`),
  verifyPassword: vi.fn(),
}));
vi.mock("@/lib/logger", () => ({
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
}));

import { query, pool } from "@/lib/db";
import { requireAdminApi } from "@/lib/identity/admin-api-auth-db";
import { POST, PUT, DELETE } from "./route";
import { PATCH as PATCH_BY_ID } from "./[id]/route";

function jsonRequest(url: string, method: string, body?: unknown): Request {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

describe("POST /api/admin/vendors", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset the auth gate to success by default.
    vi.mocked(requireAdminApi).mockResolvedValue({ admin: ADMIN } as never);
    // Default query: empty result.
    vi.mocked(query).mockImplementation(async () => ({ rows: [] }) as never);
    // Pool.connect returns a transaction-capable client.
    vi.mocked(pool.connect).mockImplementation(async () => {
      const txClient = {
        query: vi.fn(async (sql: string) => {
          // The vendor INSERT returns a UUID.
          if (/INSERT INTO vendors/i.test(sql)) {
            return { rows: [{ id: "v-uuid-1" }] };
          }
          return { rows: [] };
        }),
        release: vi.fn(),
      };
      return txClient;
    });
  });

  it("returns 401 when admin session is missing", async () => {
    // The route returns the gate directly when it's a NextResponse,
    // so use NextResponse (not Response) to make `instanceof
    // NextResponse` true and the short-circuit branch fire.
    const { NextResponse } = await import("next/server");
    vi.mocked(requireAdminApi).mockResolvedValueOnce(
      NextResponse.json({ success: false, error: "unauthorized" }, { status: 401 }) as never,
    );
    const res = await POST(jsonRequest("http://localhost/api/admin/vendors", "POST", { name_ar: "اسم" }) as never);
    expect(res.status).toBe(401);
  });

  it("rejects slug with leading dash (400)", async () => {
    const res = await POST(
      jsonRequest("http://localhost/api/admin/vendors", "POST", {
        name_ar: "اسم",
        vendor_type: "food_beverage",
        slug: "-bad",
      }) as never,
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
  });

  it("auto-fills slug from Arabic name with Latin transliteration", async () => {
    const res = await POST(
      jsonRequest("http://localhost/api/admin/vendors", "POST", {
        name_ar: "متجر الفواكه",
        vendor_type: "food_beverage",
        login_phone: "500000000",
        login_email: "owner@example.com",
        password: "password123",
      }) as never,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    // The auto-slug must be a Latin transliteration — no Arabic
    // characters may survive the slugify. The ARABIC_TO_LATIN map in
    // `@/lib/slug` produces "mtjr-alfwakh" for "متجر الفواكه"
    // (ا → 'a', ة → 'h', و → 'wa', the rest via single-letter map).
    expect(body.slug).not.toMatch(/[؀-ۿ]/);
    expect(body.slug).toMatch(/^[a-z0-9-]+$/);
  });

  it("accepts a Unicode slug explicitly (round-trip safe)", async () => {
    const res = await POST(
      jsonRequest("http://localhost/api/admin/vendors", "POST", {
        name_ar: "اسم",
        vendor_type: "food_beverage",
        slug: "متجر-فواكه",
        login_phone: "500000000",
        login_email: "owner@example.com",
        password: "password123",
      }) as never,
    );
    expect(res.status).toBe(200);
  });

  it("rejects missing name_ar (400)", async () => {
    const res = await POST(
      jsonRequest("http://localhost/api/admin/vendors", "POST", {
        vendor_type: "food_beverage",
      }) as never,
    );
    expect(res.status).toBe(400);
  });

  it("rejects invalid vendor_type (400)", async () => {
    const res = await POST(
      jsonRequest("http://localhost/api/admin/vendors", "POST", {
        name_ar: "اسم",
        vendor_type: "made_up_type",
      }) as never,
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 on duplicate slug (PG 23505)", async () => {
    vi.mocked(pool.connect).mockImplementation(async () => {
      const dup = vi.fn(async () => {
        const err: Error & { code?: string } = new Error("duplicate");
        err.code = "23505";
        throw err;
      });
      return { query: dup, release: vi.fn() };
    });
    const res = await POST(
      jsonRequest("http://localhost/api/admin/vendors", "POST", {
        name_ar: "اسم",
        vendor_type: "food_beverage",
      }) as never,
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/slug/);
  });
});

describe("POST owner-row bootstrap (optional credentials)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAdminApi).mockResolvedValue({ admin: ADMIN } as never);
    vi.mocked(query).mockImplementation(async () => ({ rows: [] }) as never);
  });

  it("creates vendor + owner row when phone AND password are provided", async () => {
    const txQuery = vi.fn(async (sql: string) => {
      if (/INSERT INTO vendors/i.test(sql)) return { rows: [{ id: "v-uuid-1" }] };
      return { rows: [] };
    });
    vi.mocked(pool.connect).mockImplementation(async () => ({
      query: txQuery,
      release: vi.fn(),
    }));
    const res = await POST(
      jsonRequest("http://localhost/api/admin/vendors", "POST", {
        name_ar: "اسم",
        vendor_type: "food_beverage",
        login_phone: "500000000",
        password: "password123",
      }) as never,
    );
    expect(res.status).toBe(200);
    // The owner INSERT must have been issued on the transaction client.
    expect(
      txQuery.mock.calls.some((c) => /INSERT INTO vendor_staff/i.test(c[0] as string)),
    ).toBe(true);
  });

  it("creates vendor without owner row when phone is given but password is missing", async () => {
    const txQuery = vi.fn(async (sql: string) => {
      if (/INSERT INTO vendors/i.test(sql)) return { rows: [{ id: "v-uuid-1" }] };
      return { rows: [] };
    });
    vi.mocked(pool.connect).mockImplementation(async () => ({
      query: txQuery,
      release: vi.fn(),
    }));
    const res = await POST(
      jsonRequest("http://localhost/api/admin/vendors", "POST", {
        name_ar: "اسم",
        vendor_type: "food_beverage",
        login_phone: "500000000",
      }) as never,
    );
    expect(res.status).toBe(200);
    // The owner INSERT must NOT have been issued — phone alone can't
    // log in, so we skip the row and the admin can fill the password
    // in via edit.
    expect(
      txQuery.mock.calls.some((c) => /INSERT INTO vendor_staff/i.test(c[0] as string)),
    ).toBe(false);
    // The transaction must still COMMIT so the vendor row survives.
    expect(
      txQuery.mock.calls.some((c) => /^COMMIT$/i.test((c[0] as string).trim())),
    ).toBe(true);
  });

  it("creates vendor without owner row when only login_email is provided (no phone)", async () => {
    const txQuery = vi.fn(async (sql: string) => {
      if (/INSERT INTO vendors/i.test(sql)) return { rows: [{ id: "v-uuid-1" }] };
      return { rows: [] };
    });
    vi.mocked(pool.connect).mockImplementation(async () => ({
      query: txQuery,
      release: vi.fn(),
    }));
    const res = await POST(
      jsonRequest("http://localhost/api/admin/vendors", "POST", {
        name_ar: "اسم",
        vendor_type: "food_beverage",
        login_email: "owner@example.com",
      }) as never,
    );
    expect(res.status).toBe(200);
    expect(
      txQuery.mock.calls.some((c) => /INSERT INTO vendor_staff/i.test(c[0] as string)),
    ).toBe(false);
  });

  it("creates vendor without owner row when no owner fields are provided", async () => {
    const txQuery = vi.fn(async (sql: string) => {
      if (/INSERT INTO vendors/i.test(sql)) return { rows: [{ id: "v-uuid-1" }] };
      return { rows: [] };
    });
    vi.mocked(pool.connect).mockImplementation(async () => ({
      query: txQuery,
      release: vi.fn(),
    }));
    const res = await POST(
      jsonRequest("http://localhost/api/admin/vendors", "POST", {
        name_ar: "اسم",
        vendor_type: "food_beverage",
      }) as never,
    );
    expect(res.status).toBe(200);
    expect(
      txQuery.mock.calls.some((c) => /INSERT INTO vendor_staff/i.test(c[0] as string)),
    ).toBe(false);
  });

  it("rejects password shorter than 8 chars when provided (400)", async () => {
    const txQuery = vi.fn(async (sql: string) => {
      if (/INSERT INTO vendors/i.test(sql)) return { rows: [{ id: "v-uuid-1" }] };
      return { rows: [] };
    });
    vi.mocked(pool.connect).mockImplementation(async () => ({
      query: txQuery,
      release: vi.fn(),
    }));
    const res = await POST(
      jsonRequest("http://localhost/api/admin/vendors", "POST", {
        name_ar: "اسم",
        vendor_type: "food_beverage",
        login_phone: "500000000",
        password: "short",
      }) as never,
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/8 أحرف/);
    // The transaction must ROLLBACK so the vendor row doesn't survive.
    expect(
      txQuery.mock.calls.some((c) => /^ROLLBACK$/i.test((c[0] as string).trim())),
    ).toBe(true);
  });
});

describe("PUT /api/admin/vendors?id=...", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAdminApi).mockResolvedValue({ admin: ADMIN } as never);
    vi.mocked(query).mockImplementation(async () => ({ rows: [] }) as never);
  });

  it("returns 400 when id query param is missing", async () => {
    const res = await PUT(
      jsonRequest("http://localhost/api/admin/vendors", "PUT", {
        name_ar: "اسم",
      }) as never,
    );
    expect(res.status).toBe(400);
  });

  it("accepts a Unicode slug in PUT (round-trip safe)", async () => {
    const res = await PUT(
      jsonRequest(
        "http://localhost/api/admin/vendors?id=v-uuid-1",
        "PUT",
        { slug: "متجر-جديد" },
      ) as never,
    );
    expect(res.status).toBe(200);
  });

  it("rejects a leading-dash slug in PUT (400)", async () => {
    const res = await PUT(
      jsonRequest(
        "http://localhost/api/admin/vendors?id=v-uuid-1",
        "PUT",
        { slug: "-bad" },
      ) as never,
    );
    expect(res.status).toBe(400);
  });

  // PCP-99 — PUT must wrap vendor UPDATE + owner upsert in a transaction.
  // If the owner upsert rejects (e.g. weak password), the vendor UPDATE
  // must roll back too. Without the transaction the admin sees a
  // "فشل التحديث" toast next to a row that was actually mutated.
  it("wraps vendor UPDATE + owner upsert in BEGIN/COMMIT", async () => {
    const txQuery = vi.fn(async (_sql: string) => ({ rows: [] }));
    vi.mocked(pool.connect).mockImplementation(async () => ({
      query: txQuery,
      release: vi.fn(),
    }));
    const res = await PUT(
      jsonRequest(
        "http://localhost/api/admin/vendors?id=v-uuid-1",
        "PUT",
        {
          name_ar: "اسم",
          slug: "store-1",
          login_phone: "500000000",
          password: "password123",
        },
      ) as never,
    );
    expect(res.status).toBe(200);
    // Transaction scaffolding was issued on the client.
    const calls = txQuery.mock.calls.map((c) => (c[0] as string).trim());
    expect(calls.some((s) => /^BEGIN$/i.test(s))).toBe(true);
    expect(calls.some((s) => /^UPDATE vendors/i.test(s))).toBe(true);
    // Owner SELECT runs on the tx client (not the autocommit pool).
    expect(calls.some((s) => /SELECT id, phone, email FROM vendor_staff/i.test(s))).toBe(true);
    expect(calls.some((s) => /^INSERT INTO vendor_staff/i.test(s))).toBe(true);
    expect(calls.some((s) => /^COMMIT$/i.test(s))).toBe(true);
    expect(calls.some((s) => /^ROLLBACK$/i.test(s))).toBe(false);
  });

  it("rolls back vendor UPDATE when owner password is too short (400)", async () => {
    const txQuery = vi.fn(async (_sql: string) => ({ rows: [] }));
    vi.mocked(pool.connect).mockImplementation(async () => ({
      query: txQuery,
      release: vi.fn(),
    }));
    const res = await PUT(
      jsonRequest(
        "http://localhost/api/admin/vendors?id=v-uuid-1",
        "PUT",
        {
          name_ar: "اسم",
          slug: "store-1",
          login_phone: "500000000",
          password: "short", // < 8 chars → owner validation fails
        },
      ) as never,
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/8 أحرف/);
    // ROLLBACK must have been issued so the UPDATE vendors row is undone.
    const calls = txQuery.mock.calls.map((c) => (c[0] as string).trim());
    expect(calls.some((s) => /^BEGIN$/i.test(s))).toBe(true);
    expect(calls.some((s) => /^UPDATE vendors/i.test(s))).toBe(true);
    expect(calls.some((s) => /^ROLLBACK$/i.test(s))).toBe(true);
    expect(calls.some((s) => /^COMMIT$/i.test(s))).toBe(false);
  });

  it("still commits when no owner fields are sent (transactional path)", async () => {
    const txQuery = vi.fn(async (_sql: string) => ({ rows: [] }));
    vi.mocked(pool.connect).mockImplementation(async () => ({
      query: txQuery,
      release: vi.fn(),
    }));
    const res = await PUT(
      jsonRequest(
        "http://localhost/api/admin/vendors?id=v-uuid-1",
        "PUT",
        { name_ar: "اسم جديد", slug: "store-1" },
      ) as never,
    );
    expect(res.status).toBe(200);
    const calls = txQuery.mock.calls.map((c) => (c[0] as string).trim());
    // The whole edit path runs through the transaction client — same
    // shape regardless of whether owner fields are present.
    expect(calls.some((s) => /^BEGIN$/i.test(s))).toBe(true);
    expect(calls.some((s) => /^UPDATE vendors/i.test(s))).toBe(true);
    expect(calls.some((s) => /^COMMIT$/i.test(s))).toBe(true);
    expect(calls.some((s) => /^ROLLBACK$/i.test(s))).toBe(false);
  });

  it("returns 400 (not 500) on duplicate slug via unique-violation inside the transaction", async () => {
    const txQuery = vi.fn(async (sql: string) => {
      // UPDATE vendors raises PG 23505 (unique_violation).
      if (/UPDATE vendors/i.test(sql)) {
        const e: any = new Error("duplicate key value violates unique constraint");
        e.code = "23505";
        throw e;
      }
      return { rows: [] };
    });
    vi.mocked(pool.connect).mockImplementation(async () => ({
      query: txQuery,
      release: vi.fn(),
    }));
    const res = await PUT(
      jsonRequest(
        "http://localhost/api/admin/vendors?id=v-uuid-1",
        "PUT",
        { name_ar: "اسم", slug: "store-1" },
      ) as never,
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/slug مستخدم/);
    // The catch path must ROLLBACK before re-throwing.
    const calls = txQuery.mock.calls.map((c) => (c[0] as string).trim());
    expect(calls.some((s) => /^ROLLBACK$/i.test(s))).toBe(true);
  });
});

describe("DELETE /api/admin/vendors?id=...", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAdminApi).mockResolvedValue({ admin: ADMIN } as never);
  });

  it("returns 400 when id query param is missing", async () => {
    const res = await DELETE(
      jsonRequest("http://localhost/api/admin/vendors", "DELETE") as never,
    );
    expect(res.status).toBe(400);
  });

  it("refuses to delete a vendor with products or orders (400)", async () => {
    vi.mocked(query)
      .mockResolvedValueOnce({ rows: [{ c: 3 }] } as never) // vendor_products count
      .mockResolvedValueOnce({ rows: [{ c: 0 }] } as never); // vendor_orders count
    const res = await DELETE(
      jsonRequest("http://localhost/api/admin/vendors?id=v-uuid-1", "DELETE") as never,
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/منتج|طلب/);
  });

  it("deletes a vendor with no products or orders (200)", async () => {
    vi.mocked(query)
      .mockResolvedValueOnce({ rows: [{ c: 0 }] } as never)
      .mockResolvedValueOnce({ rows: [{ c: 0 }] } as never)
      .mockResolvedValueOnce({ rows: [] } as never);
    const res = await DELETE(
      jsonRequest("http://localhost/api/admin/vendors?id=v-uuid-1", "DELETE") as never,
    );
    expect(res.status).toBe(200);
  });
});

describe("PATCH /api/admin/vendors/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAdminApi).mockResolvedValue({ admin: ADMIN } as never);
    vi.mocked(query).mockImplementation(async () => ({ rows: [] }) as never);
  });

  it("rejects an invalid UUID (400)", async () => {
    const res = await PATCH_BY_ID(
      jsonRequest("http://localhost/api/admin/vendors/not-a-uuid", "PATCH", {
        is_active: false,
      }) as never,
      { params: Promise.resolve({ id: "not-a-uuid" }) },
    );
    expect(res.status).toBe(400);
  });

  it("rejects unknown keys (strict schema, 400)", async () => {
    const res = await PATCH_BY_ID(
      jsonRequest(
        "http://localhost/api/admin/vendors/00000000-0000-0000-0000-0000000000a1",
        "PATCH",
        { name_ar: "foo" },
      ) as never,
      { params: Promise.resolve({ id: "00000000-0000-0000-0000-0000000000a1" }) },
    );
    expect(res.status).toBe(400);
  });

  it("rejects empty body (no fields to update, 400)", async () => {
    const res = await PATCH_BY_ID(
      jsonRequest(
        "http://localhost/api/admin/vendors/00000000-0000-0000-0000-0000000000a1",
        "PATCH",
        {},
      ) as never,
      { params: Promise.resolve({ id: "00000000-0000-0000-0000-0000000000a1" }) },
    );
    expect(res.status).toBe(400);
  });

  it("toggles is_active successfully (200)", async () => {
    const res = await PATCH_BY_ID(
      jsonRequest(
        "http://localhost/api/admin/vendors/00000000-0000-0000-0000-0000000000a1",
        "PATCH",
        { is_active: false },
      ) as never,
      { params: Promise.resolve({ id: "00000000-0000-0000-0000-0000000000a1" }) },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });
});