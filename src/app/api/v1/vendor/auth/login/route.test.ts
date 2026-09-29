/**
 * HTTP route tests for POST /api/v1/vendor/auth/login.
 *
 * Invariants:
 *   1. Valid email + password → 200 + user payload + session cookie
 *   2. Valid phone (E.164) + password → 200 (phone normalization)
 *   3. Wrong password → 401
 *   4. Disabled vendor → 403
 *   5. Disabled staff → 403
 *   6. Unknown vendor slug → 404
 *   7. Invalid JSON body / schema mismatch → 400
 *   8. Legacy `email` field is treated as identifier
 *   9. Vendor staff session JWT is signed with signVendorSessionToken
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

type QueryCall = { sql: string; params: unknown[] };

function makeFakeDb(rowsByQuery: Record<string, { rows: unknown[] }>) {
  return {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      const calls: QueryCall[] = [];
      calls.push({ sql, params });
      // Order matters in this route:
      //   1. SELECT FROM vendors WHERE slug
      //   2. SELECT FROM vendor_staff WHERE LOWER(email) OR phone
      //   3. UPDATE vendor_staff SET last_login_at
      const norm = sql.replace(/\s+/g, " ").trim().toLowerCase();
      if (norm.startsWith("select") && norm.includes("from vendors")) {
        return rowsByQuery["vendors"] ?? { rows: [] };
      }
      if (norm.startsWith("select") && norm.includes("from vendor_staff")) {
        return rowsByQuery["staff"] ?? { rows: [] };
      }
      if (norm.startsWith("update")) {
        return { rows: [] };
      }
      return { rows: [] };
    }),
  };
}

vi.mock("@/lib/db", () => ({
  query: vi.fn(),
  pool: {
    connect: vi.fn(),
    query: vi.fn(async () => ({ rows: [] })),
  },
}));
vi.mock("@/lib/password", () => ({
  verifyPassword: vi.fn(async (pw: string, hash: string) => pw === "right" && hash.startsWith("$")),
}));
vi.mock("@/lib/phone-format", () => ({
  normalizeSaudiToE164: vi.fn((s: string) => {
    // crude stub: accepts +9665XXXXXXXX or 05XXXXXXXX → +9665XXXXXXXX
    const trimmed = s.trim();
    if (/^\+9665\d{8}$/.test(trimmed)) return trimmed;
    if (/^05\d{8}$/.test(trimmed)) return "+966" + trimmed.slice(1);
    return null;
  }),
}));
vi.mock("@/lib/validation/admin", () => ({
  vendorStaffLoginSchema: {
    safeParse: vi.fn((b: unknown) => {
      const obj = b as { identifier?: string; email?: string; password?: string; vendorSlug?: string };
      const id = obj.identifier ?? obj.email;
      if (typeof id !== "string" || id.length < 3) {
        return {
          success: false,
          error: { issues: [{ message: "بيانات الدخول غير صالحة" }] },
        };
      }
      if (typeof obj.password !== "string" || obj.password.length < 1) {
        return {
          success: false,
          error: { issues: [{ message: "كلمة المرور مطلوبة" }] },
        };
      }
      if (typeof obj.vendorSlug !== "string" || obj.vendorSlug.length < 1) {
        return {
          success: false,
          error: { issues: [{ message: "المتجر مطلوب" }] },
        };
      }
      return {
        success: true,
        data: { identifier: id, password: obj.password, vendorSlug: obj.vendorSlug },
      };
    }),
  },
}));
vi.mock("@/lib/identity", () => ({
  signVendorSessionToken: vi.fn(async () => "jwt.vendor.test"),
  vendorSessionCookieOptions: vi.fn(() => ({
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  })),
  VENDOR_SESSION_COOKIE: "vendor_session",
}));
vi.mock("@/lib/logger", () => ({
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
}));

import { query } from "@/lib/db";
import { verifyPassword } from "@/lib/password";
import { signVendorSessionToken } from "@/lib/identity";
import { POST } from "./route";

const VENDOR_ACTIVE = {
  id: "00000000-0000-0000-0000-000000000001",
  slug: "burger-palace",
  name_ar: "برجر بالاس",
  is_active: true,
};

const STAFF_OK = {
  id: "00000000-0000-0000-0000-000000000010",
  vendor_id: VENDOR_ACTIVE.id,
  email: "owner@example.com",
  phone: "0501234567",
  password_hash: "$argon2id$abc",
  full_name_ar: "مالك المتجر",
  full_name_en: "Owner",
  role: "owner",
  permissions: [],
  is_active: true,
};

function postJson(body: unknown): Request {
  return new Request("http://localhost/api/v1/vendor/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/v1/vendor/auth/login — happy paths", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("email + correct password → 200 + session cookie + user payload", async () => {
    vi.mocked(query)
      .mockResolvedValueOnce({ rows: [VENDOR_ACTIVE] } as never)
      .mockResolvedValueOnce({ rows: [STAFF_OK] } as never);
    const res = await POST(
      postJson({
        identifier: "owner@example.com",
        password: "right",
        vendorSlug: "burger-palace",
      }) as never,
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.user).toMatchObject({
      id: STAFF_OK.id,
      email: STAFF_OK.email,
      role: "owner",
    });
    // session cookie set
    const cookies = res.headers.getSetCookie();
    expect(cookies.join(" ")).toContain("vendor_session=jwt.vendor.test");
    expect(vi.mocked(signVendorSessionToken)).toHaveBeenCalledTimes(1);
  });

  it("phone (E.164) + correct password → 200", async () => {
    vi.mocked(query)
      .mockResolvedValueOnce({ rows: [VENDOR_ACTIVE] } as never)
      .mockResolvedValueOnce({ rows: [STAFF_OK] } as never);
    const res = await POST(
      postJson({
        identifier: "+966501234567",
        password: "right",
        vendorSlug: "burger-palace",
      }) as never,
    );
    expect(res.status).toBe(200);
  });

  it("phone (local 05XXXXXXXX) + correct password → 200 (normalized)", async () => {
    vi.mocked(query)
      .mockResolvedValueOnce({ rows: [VENDOR_ACTIVE] } as never)
      .mockResolvedValueOnce({ rows: [STAFF_OK] } as never);
    const res = await POST(
      postJson({
        identifier: "0501234567",
        password: "right",
        vendorSlug: "burger-palace",
      }) as never,
    );
    expect(res.status).toBe(200);
    // Phone lookup SQL must include BOTH the E.164 and local forms
    const calls = vi.mocked(query).mock.calls;
    const staffCall = calls[1];
    expect(staffCall[1]).toContain("+966501234567");
    expect(staffCall[1]).toContain("0501234567");
  });

  it("legacy `email` field still works (back-compat)", async () => {
    vi.mocked(query)
      .mockResolvedValueOnce({ rows: [VENDOR_ACTIVE] } as never)
      .mockResolvedValueOnce({ rows: [STAFF_OK] } as never);
    const res = await POST(
      postJson({
        email: "owner@example.com",
        password: "right",
        vendorSlug: "burger-palace",
      }) as never,
    );
    expect(res.status).toBe(200);
  });
});

describe("POST /api/v1/vendor/auth/login — failure paths", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("unknown vendor slug → 404", async () => {
    vi.mocked(query).mockResolvedValueOnce({ rows: [] } as never);
    const res = await POST(
      postJson({
        identifier: "owner@example.com",
        password: "right",
        vendorSlug: "missing",
      }) as never,
    );
    expect(res.status).toBe(404);
  });

  it("disabled vendor → 403", async () => {
    vi.mocked(query).mockResolvedValueOnce({
      rows: [{ ...VENDOR_ACTIVE, is_active: false }],
    } as never);
    const res = await POST(
      postJson({
        identifier: "owner@example.com",
        password: "right",
        vendorSlug: "burger-palace",
      }) as never,
    );
    expect(res.status).toBe(403);
  });

  it("wrong password → 401", async () => {
    vi.mocked(query)
      .mockResolvedValueOnce({ rows: [VENDOR_ACTIVE] } as never)
      .mockResolvedValueOnce({ rows: [STAFF_OK] } as never);
    vi.mocked(verifyPassword).mockResolvedValueOnce(false as never);
    const res = await POST(
      postJson({
        identifier: "owner@example.com",
        password: "wrong",
        vendorSlug: "burger-palace",
      }) as never,
    );
    expect(res.status).toBe(401);
  });

  it("disabled staff → 403", async () => {
    vi.mocked(query)
      .mockResolvedValueOnce({ rows: [VENDOR_ACTIVE] } as never)
      .mockResolvedValueOnce({
        rows: [{ ...STAFF_OK, is_active: false }],
      } as never);
    const res = await POST(
      postJson({
        identifier: "owner@example.com",
        password: "right",
        vendorSlug: "burger-palace",
      }) as never,
    );
    expect(res.status).toBe(403);
  });

  it("unknown staff identifier → 401 (no enumeration)", async () => {
    vi.mocked(query)
      .mockResolvedValueOnce({ rows: [VENDOR_ACTIVE] } as never)
      .mockResolvedValueOnce({ rows: [] } as never);
    const res = await POST(
      postJson({
        identifier: "ghost@example.com",
        password: "right",
        vendorSlug: "burger-palace",
      }) as never,
    );
    expect(res.status).toBe(401);
  });

  it("invalid phone (no Saudi mobile match) → 400", async () => {
    vi.mocked(query).mockResolvedValueOnce({
      rows: [VENDOR_ACTIVE],
    } as never);
    const res = await POST(
      postJson({
        identifier: "not-a-phone",
        password: "right",
        vendorSlug: "burger-palace",
      }) as never,
    );
    expect(res.status).toBe(400);
  });
});