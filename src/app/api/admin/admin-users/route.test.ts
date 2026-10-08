import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * SECURITY regression: `manage_roles` is held by both `super_admin` and
 * `admin`. Only a super_admin may create / edit / delete super_admin
 * accounts or grant that role, and nobody may change their own role or
 * deactivate themselves.
 */

type QueryCall = { sql: string; params: unknown[] };
const calls: QueryCall[] = [];
let targetRole: string | null = "super_admin";
let caller: { id: string; email: string; role: string } = {
  id: "caller-1",
  email: "staff@citymarkets.sa",
  role: "admin",
};

vi.mock("@/lib/db", () => ({
  query: vi.fn(async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    if (/SELECT role::text AS role FROM admin_users/.test(sql)) {
      return { rows: targetRole ? [{ role: targetRole }] : [] };
    }
    return { rows: [{ id: "new-1" }] };
  }),
}));

vi.mock("@/lib/identity/admin-api-auth-db", () => ({
  requireAdminApi: vi.fn(async () => ({ admin: caller })),
  clearAdminRoleCache: vi.fn(),
}));

vi.mock("@/lib/admin-audit", () => ({ logAdminAction: vi.fn() }));
vi.mock("@/lib/password", () => ({ hashPassword: vi.fn(async () => "hashed") }));

import { POST, PUT, DELETE } from "./route";

function req(method: string, url: string, body?: unknown) {
  return {
    method,
    url,
    headers: { get: () => null },
    json: async () => body,
  } as never;
}

const staffBody = (role: string, extra: Record<string, unknown> = {}) => ({
  name: "Test",
  phone: "0551112222",
  email: "t@citymarkets.sa",
  role,
  is_active: true,
  ...extra,
});

const mutated = () => calls.some((c) => /^\s*(UPDATE|DELETE|INSERT)/i.test(c.sql));

describe("admin-users role hierarchy", () => {
  beforeEach(() => {
    calls.length = 0;
    targetRole = "super_admin";
    caller = { id: "caller-1", email: "staff@citymarkets.sa", role: "admin" };
  });

  it("admin cannot reset a super_admin's password", async () => {
    const res = await PUT(
      req("PUT", "http://x/api/admin/admin-users?id=owner-1", staffBody("super_admin", { password: "NewPass123!" })),
    );
    expect(res.status).toBe(403);
    expect(mutated()).toBe(false);
  });

  it("admin cannot demote a super_admin", async () => {
    const res = await PUT(req("PUT", "http://x/api/admin/admin-users?id=owner-1", staffBody("viewer")));
    expect(res.status).toBe(403);
    expect(mutated()).toBe(false);
  });

  it("admin cannot promote someone to super_admin", async () => {
    targetRole = "editor";
    const res = await PUT(req("PUT", "http://x/api/admin/admin-users?id=ed-1", staffBody("super_admin")));
    expect(res.status).toBe(403);
    expect(mutated()).toBe(false);
  });

  it("admin cannot create a super_admin", async () => {
    const res = await POST(
      req("POST", "http://x/api/admin/admin-users", staffBody("super_admin", { password: "NewPass123!" })),
    );
    expect(res.status).toBe(403);
    expect(mutated()).toBe(false);
  });

  it("admin cannot delete a super_admin", async () => {
    const res = await DELETE(req("DELETE", "http://x/api/admin/admin-users?id=owner-1"));
    expect(res.status).toBe(403);
    expect(mutated()).toBe(false);
  });

  it("admin cannot change their own role or deactivate themselves", async () => {
    targetRole = "admin";
    const promote = await PUT(req("PUT", "http://x/api/admin/admin-users?id=caller-1", staffBody("editor")));
    expect(promote.status).toBe(403);
    const deactivate = await PUT(
      req("PUT", "http://x/api/admin/admin-users?id=caller-1", staffBody("admin", { is_active: false })),
    );
    expect(deactivate.status).toBe(403);
    expect(mutated()).toBe(false);
  });

  it("admin can still edit a regular editor", async () => {
    targetRole = "editor";
    const res = await PUT(req("PUT", "http://x/api/admin/admin-users?id=ed-1", staffBody("editor")));
    expect(res.status).toBe(200);
    expect(mutated()).toBe(true);
  });

  it("super_admin can manage super_admin accounts", async () => {
    caller = { id: "owner-0", email: "admin@citymarkets.sa", role: "super_admin" };
    const put = await PUT(req("PUT", "http://x/api/admin/admin-users?id=owner-1", staffBody("super_admin")));
    expect(put.status).toBe(200);
    const del = await DELETE(req("DELETE", "http://x/api/admin/admin-users?id=owner-1"));
    expect(del.status).toBe(200);
  });

  it("returns 404 when editing a missing user", async () => {
    targetRole = null;
    const res = await PUT(req("PUT", "http://x/api/admin/admin-users?id=ghost", staffBody("editor")));
    expect(res.status).toBe(404);
  });
});
