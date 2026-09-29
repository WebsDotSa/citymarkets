import { describe, it, expect, beforeEach, vi } from "vitest";
import type { NextRequest } from "next/server";
import { SignJWT } from "jose";

const SECRET = new TextEncoder().encode(
  "city-market-dev-admin-secret-min-32-characters-x",
);

async function mintToken(role: string): Promise<string> {
  return new SignJWT({ email: "a@x", role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject("admin-1")
    .setIssuedAt()
    .setIssuer("citymarket-admin")
    .setAudience("citymarket-admin-api")
    .setExpirationTime("7d")
    .sign(SECRET);
}

function fakeRequest(cookieValue?: string): NextRequest {
  return {
    cookies: {
      get: (name: string) =>
        cookieValue !== undefined ? { name, value: cookieValue } : undefined,
    },
    headers: new Headers(),
  } as unknown as NextRequest;
}

// Mock @/lib/db so the cache miss path can use a fake pool.
const mockPoolQuery = vi.fn();
vi.mock("@/lib/db", () => ({
  pool: {
    query: (...args: unknown[]) => mockPoolQuery(...args),
  },
}));

import {
  adminUnauthorized,
  adminForbidden,
  adminHasPermission,
} from "./admin-api-auth";
import { clearAdminRoleCache, requireAdminApi } from "./admin-api-auth-db";

describe("admin-api-auth helpers", () => {
  beforeEach(() => {
    mockPoolQuery.mockReset();
    clearAdminRoleCache();
  });

  it("adminUnauthorized returns 401 with Arabic error", async () => {
    const res = adminUnauthorized();
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.error).toBe("يجب تسجيل الدخول");
  });

  it("adminForbidden returns 403 with Arabic error", async () => {
    const res = adminForbidden();
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.error).toBe("ليست لديك صلاحية لهذا الإجراء");
  });

  describe("adminHasPermission", () => {
    it("returns true when the role has the permission", () => {
      expect(adminHasPermission("super_admin", "manage_roles")).toBe(true);
      expect(adminHasPermission("admin", "manage_products")).toBe(true);
    });

    it("returns false when the role lacks the permission", () => {
      expect(adminHasPermission("viewer", "manage_products")).toBe(false);
      expect(adminHasPermission("editor", "manage_orders")).toBe(false);
    });

    it("returns false for an unknown role", () => {
      // The function falls back to a non-array and returns false
      expect(
        adminHasPermission("nonexistent" as unknown as Parameters<
          typeof adminHasPermission
        >[0], "view_dashboard"),
      ).toBe(false);
    });
  });

  describe("clearAdminRoleCache", () => {
    it("clears only the given id when an id is provided", async () => {
      // populate the cache via requireAdminApi
      const token = await mintToken("admin");
      mockPoolQuery.mockResolvedValueOnce({
        rows: [{ role: "admin", is_active: true }],
        rowCount: 1,
      });
      await requireAdminApi(fakeRequest(token));
      clearAdminRoleCache("admin-1");
      // Next call should re-query the DB (no cache hit)
      mockPoolQuery.mockResolvedValueOnce({
        rows: [{ role: "admin", is_active: true }],
        rowCount: 1,
      });
      await requireAdminApi(fakeRequest(token));
      expect(mockPoolQuery).toHaveBeenCalledTimes(2);
    });

    it("clears everything when called with no id", async () => {
      clearAdminRoleCache(); // sanity
      expect(() => clearAdminRoleCache()).not.toThrow();
    });
  });

  describe("requireAdminApi", () => {
    it("returns 401 when no admin cookie is present", async () => {
      const out = await requireAdminApi(fakeRequest());
      expect(out).not.toBeNull();
      // The response object is a NextResponse, distinguishable from {admin}
      expect("status" in out).toBe(true);
      if ("status" in out) {
        expect((out as { status: number }).status).toBe(401);
      }
    });

    it("returns 401 when the JWT is invalid", async () => {
      const out = await requireAdminApi(fakeRequest("not-a-jwt"));
      expect("status" in out).toBe(true);
      if ("status" in out) {
        expect((out as { status: number }).status).toBe(401);
      }
      // No DB query needed because JWT verification failed.
      expect(mockPoolQuery).not.toHaveBeenCalled();
    });

    it("returns {admin} when JWT is valid, role matches DB, and no permission required", async () => {
      const token = await mintToken("admin");
      mockPoolQuery.mockResolvedValueOnce({
        rows: [{ role: "admin", is_active: true }],
        rowCount: 1,
      });

      const out = await requireAdminApi(fakeRequest(token));
      expect("admin" in out).toBe(true);
      if ("admin" in out) {
        expect(out.admin.id).toBe("admin-1");
        expect(out.admin.role).toBe("admin");
      }
    });

    it("returns 401 when DB says the admin is inactive", async () => {
      const token = await mintToken("admin");
      mockPoolQuery.mockResolvedValueOnce({
        rows: [{ role: "admin", is_active: false }],
        rowCount: 1,
      });

      const out = await requireAdminApi(fakeRequest(token));
      if ("status" in out) {
        expect((out as { status: number }).status).toBe(401);
      } else {
        throw new Error("expected 401 response");
      }
    });

    it("returns 401 when DB returns no row for the admin id", async () => {
      const token = await mintToken("admin");
      mockPoolQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      const out = await requireAdminApi(fakeRequest(token));
      if ("status" in out) {
        expect((out as { status: number }).status).toBe(401);
      } else {
        throw new Error("expected 401 response");
      }
    });

    it("returns 401 when the DB query throws (e.g. connection lost)", async () => {
      const token = await mintToken("admin");
      mockPoolQuery.mockRejectedValueOnce(new Error("db down"));

      const out = await requireAdminApi(fakeRequest(token));
      if ("status" in out) {
        expect((out as { status: number }).status).toBe(401);
      } else {
        throw new Error("expected 401 response");
      }
    });

    it("returns 403 when the DB role no longer matches the JWT role (demoted)", async () => {
      const token = await mintToken("super_admin");
      mockPoolQuery.mockResolvedValueOnce({
        rows: [{ role: "viewer", is_active: true }], // demoted
        rowCount: 1,
      });

      const out = await requireAdminApi(fakeRequest(token));
      if ("status" in out) {
        expect((out as { status: number }).status).toBe(403);
      } else {
        throw new Error("expected 403 response");
      }
    });

    it("returns 403 when the admin lacks the required permission", async () => {
      const token = await mintToken("viewer");
      mockPoolQuery.mockResolvedValueOnce({
        rows: [{ role: "viewer", is_active: true }],
        rowCount: 1,
      });

      const out = await requireAdminApi(fakeRequest(token), "manage_products");
      if ("status" in out) {
        expect((out as { status: number }).status).toBe(403);
      } else {
        throw new Error("expected 403 response");
      }
    });

    it("returns {admin} when the admin has the required permission", async () => {
      const token = await mintToken("super_admin");
      mockPoolQuery.mockResolvedValueOnce({
        rows: [{ role: "super_admin", is_active: true }],
        rowCount: 1,
      });

      const out = await requireAdminApi(fakeRequest(token), "manage_roles");
      expect("admin" in out).toBe(true);
    });

    it("caches the role lookup for 60s (second call does not re-query)", async () => {
      const token = await mintToken("admin");
      mockPoolQuery.mockResolvedValueOnce({
        rows: [{ role: "admin", is_active: true }],
        rowCount: 1,
      });

      await requireAdminApi(fakeRequest(token));
      await requireAdminApi(fakeRequest(token));
      await requireAdminApi(fakeRequest(token));

      expect(mockPoolQuery).toHaveBeenCalledTimes(1);
    });

    it("does not return a stale cached entry after clearAdminRoleCache", async () => {
      const token = await mintToken("admin");
      mockPoolQuery.mockResolvedValue({
        rows: [{ role: "admin", is_active: true }],
        rowCount: 1,
      });
      await requireAdminApi(fakeRequest(token));
      clearAdminRoleCache("admin-1");
      await requireAdminApi(fakeRequest(token));
      expect(mockPoolQuery).toHaveBeenCalledTimes(2);
    });
  });
});