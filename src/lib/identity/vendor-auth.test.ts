import { describe, it, expect, vi, beforeEach } from "vitest";
import { SignJWT } from "jose";
import type { NextRequest } from "next/server";

// Provide a deterministic VENDOR_JWT_SECRET so jose sign/verify works.
// vendor-auth.ts reads VENDOR_JWT_SECRET (NOT JWT_SECRET) via env.ts.
const SECRET_STR = "vendor-dev-secret-min-32-characters-long-x";
const SECRET = new TextEncoder().encode(SECRET_STR);
process.env.VENDOR_JWT_SECRET = SECRET_STR;
process.env.JWT_SECRET = SECRET_STR;
delete (process.env as any).NODE_ENV;

const mockQuery = vi.fn();
vi.mock("@/lib/db", () => ({
  query: (...args: unknown[]) => mockQuery(...args),
}));

const ISS = "citymarket-vendor";
const AUD = "citymarket-vendor-api";

async function mintToken(payload: {
  sub?: string;
  vendorId?: string;
  vendorSlug?: string;
  email?: string;
  fullName?: string;
  role?: string;
  permissions?: string[];
  iss?: string;
  aud?: string;
}): Promise<string> {
  return new SignJWT({
    vendorId: payload.vendorId ?? "v1",
    vendorSlug: payload.vendorSlug ?? "vendor-1",
    email: payload.email ?? "vendor@example.com",
    fullName: payload.fullName ?? "Vendor Owner",
    role: payload.role ?? "owner",
    permissions: payload.permissions ?? [],
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(payload.sub ?? "staff-1")
    .setIssuedAt()
    .setIssuer(payload.iss ?? ISS)
    .setAudience(payload.aud ?? AUD)
    .setExpirationTime("8h")
    .sign(SECRET);
}

function fakeReq(cookieValue?: string): NextRequest {
  return {
    cookies: {
      get: (name: string) =>
        cookieValue !== undefined
          ? { name, value: cookieValue }
          : undefined,
    },
    headers: new Headers(),
  } as unknown as NextRequest;
}

let mod: typeof import("./vendor-auth");
let modWithDb: typeof import("./vendor-auth-with-db");

beforeEach(async () => {
  mockQuery.mockReset();
  mod = await import("./vendor-auth");
  modWithDb = await import("./vendor-auth-with-db");
});

describe("signVendorSessionToken / verifyVendorRequest (JWT round-trip)", () => {
  it("round-trips: sign → verify returns the original session", async () => {
    const token = await mod.signVendorSessionToken({
      vendorId: "v1",
      vendorSlug: "vendor-1",
      staffId: "staff-7",
      email: "owner@example.com",
      fullName: "Owner Seven",
      role: "owner",
      permissions: ["view", "edit"],
    });
    const out = await mod.verifyVendorRequest(fakeReq(token));
    expect(out).toEqual({
      vendorId: "v1",
      vendorSlug: "vendor-1",
      staffId: "staff-7",
      email: "owner@example.com",
      fullName: "Owner Seven",
      role: "owner",
      permissions: ["view", "edit"],
      // SECURITY (PCP-144): the verifier always populates
      // `tokenVersion` on the returned object (defaults to 1 for
      // legacy tokens that do not carry the claim). Round-trip
      // therefore includes the field.
      tokenVersion: 1,
    });
  });

  it("signs with iss=citymarket-vendor and aud=citymarket-vendor-api", async () => {
    const token = await mod.signVendorSessionToken({
      vendorId: "v1",
      vendorSlug: "s",
      staffId: "s",
      email: "e",
      fullName: "F",
      role: "owner",
      permissions: [],
    });
    const header = JSON.parse(atob(token.split(".")[0]));
    expect(header.alg).toBe("HS256");
    const payload = JSON.parse(atob(token.split(".")[1]));
    expect(payload.iss).toBe("citymarket-vendor");
    expect(payload.aud).toBe("citymarket-vendor-api");
    expect(payload.sub).toBe("s");
    expect(payload.exp - payload.iat).toBe(8 * 60 * 60);
  });

  it("returns null when the cookie is absent", async () => {
    expect(await mod.verifyVendorRequest(fakeReq())).toBeNull();
  });

  it("returns null when the cookie is forged", async () => {
    expect(await mod.verifyVendorRequest(fakeReq("not-a-jwt"))).toBeNull();
  });

  it("returns null when the issuer is wrong", async () => {
    const t = await mintToken({ iss: "evil-issuer" });
    expect(await mod.verifyVendorRequest(fakeReq(t))).toBeNull();
  });

  it("returns null when the audience is wrong", async () => {
    const t = await mintToken({ aud: "wrong-aud" });
    expect(await mod.verifyVendorRequest(fakeReq(t))).toBeNull();
  });

  it("returns null when the token is missing required claims", async () => {
    const t = await mintToken({ sub: "" });
    expect(await mod.verifyVendorRequest(fakeReq(t))).toBeNull();
  });

  it("verifies the VENDOR_SESSION_COOKIE re-export", () => {
    expect(mod.VENDOR_SESSION_COOKIE).toBe("vendor_session");
  });
});

describe("clearVendorSessionCache", () => {
  it("does not throw when no cache has been primed", () => {
    expect(() => mod.clearVendorSessionCache()).not.toThrow();
    expect(() => mod.clearVendorSessionCache("staff-x")).not.toThrow();
  });
});

describe("vendorSessionCookieOptions", () => {
  it("is httpOnly, sameSite=lax, path=/, 8h maxAge, secure based on NODE_ENV", () => {
    const opts = mod.vendorSessionCookieOptions();
    expect(opts.httpOnly).toBe(true);
    expect(opts.sameSite).toBe("lax");
    expect(opts.path).toBe("/");
    expect(opts.maxAge).toBe(8 * 60 * 60);
    expect(typeof opts.secure).toBe("boolean");
  });
});

describe("verifyVendorRequestWithDb", () => {
  it("returns null when verifyVendorRequest returns null", async () => {
    expect(await modWithDb.verifyVendorRequestWithDb(fakeReq())).toBeNull();
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("returns null when the DB has no row for the staff/vendor", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const t = await mintToken({});
    expect(await modWithDb.verifyVendorRequestWithDb(fakeReq(t))).toBeNull();
  });

  it("returns null when staff is inactive", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: "staff-1",
          email: "x",
          full_name_ar: "x",
          full_name_en: null,
          role: "owner",
          permissions: [],
          is_active: false,
          token_version: 1,
          vendor_id: "v1",
          vendor_slug: "vendor-1",
          vendor_is_active: true,
        },
      ],
    });
    const t = await mintToken({});
    expect(await modWithDb.verifyVendorRequestWithDb(fakeReq(t))).toBeNull();
  });

  it("returns null when vendor is inactive", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: "staff-1",
          email: "x",
          full_name_ar: "x",
          full_name_en: null,
          role: "owner",
          permissions: [],
          is_active: true,
          token_version: 1,
          vendor_id: "v1",
          vendor_slug: "vendor-1",
          vendor_is_active: false,
        },
      ],
    });
    const t = await mintToken({});
    expect(await modWithDb.verifyVendorRequestWithDb(fakeReq(t))).toBeNull();
  });

  it("returns null when the DB role no longer matches the JWT (demoted)", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: "staff-1",
          email: "x",
          full_name_ar: "x",
          full_name_en: null,
          role: "viewer", // DB has demoted to viewer
          permissions: [],
          is_active: true,
          token_version: 1,
          vendor_id: "v1",
          vendor_slug: "vendor-1",
          vendor_is_active: true,
        },
      ],
    });
    const t = await mintToken({ role: "owner" });
    expect(await modWithDb.verifyVendorRequestWithDb(fakeReq(t))).toBeNull();
  });

  it("returns the vendor session on a healthy lookup", async () => {
    mockQuery.mockReset();
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: "staff-1",
          email: "owner@example.com",
          full_name_ar: "صاحب المتجر",
          full_name_en: "Vendor Owner",
          role: "owner",
          permissions: ["manage_products"],
          is_active: true,
          token_version: 1,
          vendor_id: "v-1",
          vendor_slug: "vendor-one",
          vendor_is_active: true,
        },
      ],
    });
    const t = await mintToken({});
    mod.clearVendorSessionCache();
    const out = await modWithDb.verifyVendorRequestWithDb(fakeReq(t));
    expect(out).toMatchObject({
      vendorId: "v-1",
      vendorSlug: "vendor-one",
      staffId: "staff-1",
      email: "owner@example.com",
      fullName: "صاحب المتجر",
      role: "owner",
      permissions: ["manage_products"],
    });
  });
});

describe("hasMinRole (owner > manager > staff > viewer)", () => {
  it("owner passes all checks", () => {
    expect(mod.hasMinRole("owner", "owner")).toBe(true);
    expect(mod.hasMinRole("owner", "manager")).toBe(true);
    expect(mod.hasMinRole("owner", "staff")).toBe(true);
    expect(mod.hasMinRole("owner", "viewer")).toBe(true);
  });

  it("manager does not pass owner check but passes manager/staff/viewer", () => {
    expect(mod.hasMinRole("manager", "owner")).toBe(false);
    expect(mod.hasMinRole("manager", "manager")).toBe(true);
    expect(mod.hasMinRole("manager", "staff")).toBe(true);
    expect(mod.hasMinRole("manager", "viewer")).toBe(true);
  });

  it("staff passes only staff and viewer checks", () => {
    expect(mod.hasMinRole("staff", "owner")).toBe(false);
    expect(mod.hasMinRole("staff", "manager")).toBe(false);
    expect(mod.hasMinRole("staff", "staff")).toBe(true);
    expect(mod.hasMinRole("staff", "viewer")).toBe(true);
  });

  it("viewer passes only viewer check", () => {
    expect(mod.hasMinRole("viewer", "owner")).toBe(false);
    expect(mod.hasMinRole("viewer", "manager")).toBe(false);
    expect(mod.hasMinRole("viewer", "staff")).toBe(false);
    expect(mod.hasMinRole("viewer", "viewer")).toBe(true);
  });
});

describe("hasPermission", () => {
  it("returns true for all permissions for owner", () => {
    expect(
      mod.hasPermission(
        { role: "owner", permissions: [] } as never,
        "manage_everything",
      ),
    ).toBe(true);
  });

  it("returns true for all permissions for manager", () => {
    expect(
      mod.hasPermission(
        { role: "manager", permissions: [] } as never,
        "manage_everything",
      ),
    ).toBe(true);
  });

  it("returns permissions array presence for staff/viewer", () => {
    expect(
      mod.hasPermission(
        { role: "staff", permissions: ["manage_products"] } as never,
        "manage_products",
      ),
    ).toBe(true);
    expect(
      mod.hasPermission(
        { role: "staff", permissions: [] } as never,
        "manage_products",
      ),
    ).toBe(false);
    expect(
      mod.hasPermission(
        { role: "viewer", permissions: ["view_only"] } as never,
        "view_only",
      ),
    ).toBe(true);
  });
});

describe("requireVendorRole (Arabic response)", () => {
  it("returns 401 when session is missing", async () => {
    const res = mod.requireVendorRole(null, "staff");
    expect(res).not.toBeNull();
    expect(res!.status).toBe(401);
    const json = await res!.json();
    expect(json.error).toBe("غير مصرح");
  });

  it("returns 403 with Arabic message when role is too low", async () => {
    const res = mod.requireVendorRole(
      { role: "viewer", permissions: [], vendorId: "v", vendorSlug: "v", staffId: "s", email: "e", fullName: "f" } as never,
      "manager",
    );
    expect(res).not.toBeNull();
    expect(res!.status).toBe(403);
    const json = await res!.json();
    expect(json.error).toBe("ليس لديك صلاحية كافية");
  });

  it("returns null when the role is sufficient", () => {
    expect(
      mod.requireVendorRole(
        { role: "owner", permissions: [], vendorId: "v", vendorSlug: "v", staffId: "s", email: "e", fullName: "f" } as never,
        "staff",
      ),
    ).toBeNull();
  });
});

describe("requireVendorMatch (Arabic response)", () => {
  it("returns 401 when session is null", async () => {
    const res = mod.requireVendorMatch(null, "v1");
    expect(res).not.toBeNull();
    expect(res!.status).toBe(401);
  });

  it("returns 403 when session.vendorId differs from the URL", async () => {
    const res = mod.requireVendorMatch(
      { role: "owner", permissions: [], vendorId: "v1", vendorSlug: "v1", staffId: "s", email: "e", fullName: "f" } as never,
      "v2",
    );
    expect(res).not.toBeNull();
    expect(res!.status).toBe(403);
    const json = await res!.json();
    expect(json.error).toBe("غير مصرح بالوصول لهذا المتجر");
  });

  it("returns null when vendor ids match", () => {
    expect(
      mod.requireVendorMatch(
        { role: "owner", permissions: [], vendorId: "v1", vendorSlug: "v1", staffId: "s", email: "e", fullName: "f" } as never,
        "v1",
      ),
    ).toBeNull();
  });
});
