import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  query: vi.fn(),
}));

vi.mock("@/lib/logger", () => ({
  error: vi.fn(),
}));

vi.mock("@/lib/request-ip", () => ({
  getClientIp: vi.fn(),
}));

import { logAdminAction } from "./admin-audit";
import { query } from "@/lib/db";
import { error as logError } from "@/lib/logger";
import { getClientIp } from "@/lib/request-ip";
import type { QueryResult, QueryResultRow } from "pg";

const mockQuery = vi.mocked(query);
const mockLogError = vi.mocked(logError);
const mockGetClientIp = vi.mocked(getClientIp);

/**
 * Helper to cast the minimal `{ rows, rowCount }` shape the tests use
 * into a full `QueryResult` — the type now requires `command`, `oid`,
 * and `fields` and the tests don't care about those.
 */
function qr<T extends QueryResultRow = QueryResultRow>(rows: T[] = [], rowCount = rows.length): QueryResult<T> {
  return { rows, rowCount, command: "", oid: 0, fields: [] };
}

const baseAdmin = { id: "admin-1", email: "admin@example.com", name: "مدير" };

describe("logAdminAction", () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockLogError.mockReset();
    mockGetClientIp.mockReset();
  });

  it("inserts a row into admin_audit_logs with the right column order", async () => {
    mockQuery.mockResolvedValueOnce(qr());
    await logAdminAction(baseAdmin, "create_vendor", {
      entityType: "vendor",
      entityId: 42,
      details: { reason: "manual" },
    });

    expect(mockQuery).toHaveBeenCalledTimes(1);
    const sql = mockQuery.mock.calls[0][0] as string;
    expect(sql).toMatch(/INSERT INTO admin_audit_logs/i);
    expect(sql).toMatch(/admin_id/);
    expect(sql).toMatch(/admin_email/);
    expect(sql).toMatch(/admin_name/);
    expect(sql).toMatch(/action/);
    expect(sql).toMatch(/entity_type/);
    expect(sql).toMatch(/entity_id/);
    expect(sql).toMatch(/details/);
    expect(sql).toMatch(/ip_address/);

    const params = mockQuery.mock.calls[0][1] as unknown[];
    expect(params[0]).toBe(baseAdmin.id);
    expect(params[1]).toBe(baseAdmin.email);
    expect(params[2]).toBe(baseAdmin.name);
    expect(params[3]).toBe("create_vendor");
    expect(params[4]).toBe("vendor");
    expect(params[5]).toBe("42"); // entityId coerced to string
    expect(params[6]).toBe(JSON.stringify({ reason: "manual" }));
    expect(params[7]).toBeNull();
  });

  it("coerces numeric entityId to string (PostgreSQL can store as TEXT)", async () => {
    mockQuery.mockResolvedValueOnce(qr());
    await logAdminAction(baseAdmin, "x", { entityId: 999 });
    const params = mockQuery.mock.calls[0][1] as unknown[];
    expect(params[5]).toBe("999");
  });

  it("defaults missing optional fields to null / empty JSON", async () => {
    mockQuery.mockResolvedValueOnce(qr());
    await logAdminAction(baseAdmin, "x");
    const params = mockQuery.mock.calls[0][1] as unknown[];
    expect(params[4]).toBeNull(); // entityType
    expect(params[5]).toBeNull(); // entityId
    expect(params[6]).toBe("{}"); // details default
    expect(params[7]).toBeNull(); // ip (no request)
  });

  it("uses null for admin_name when the admin object has none", async () => {
    mockQuery.mockResolvedValueOnce(qr());
    await logAdminAction({ id: "a", email: "e@x" }, "x");
    const params = mockQuery.mock.calls[0][1] as unknown[];
    expect(params[2]).toBeNull();
  });

  it("captures the client IP when a request is provided", async () => {
    mockGetClientIp.mockReturnValueOnce("203.0.113.1");
    mockQuery.mockResolvedValueOnce(qr());

    // We don't need a fully-typed NextRequest for this call — pass a stub
    // and rely on getClientIp being mocked.
    const fakeRequest = { headers: new Map() } as unknown as Parameters<
      typeof logAdminAction
    >[1] extends infer T
      ? T extends { request?: infer R }
        ? R
        : never
      : never;
    await logAdminAction(baseAdmin, "x", { request: fakeRequest });

    expect(mockGetClientIp).toHaveBeenCalledWith(fakeRequest);
    const params = mockQuery.mock.calls[0][1] as unknown[];
    expect(params[7]).toBe("203.0.113.1");
  });

  it("swallows errors and logs them — does not throw", async () => {
    mockQuery.mockRejectedValueOnce(new Error("db down"));
    await expect(
      logAdminAction(baseAdmin, "create_vendor"),
    ).resolves.toBeUndefined();
    expect(mockLogError).toHaveBeenCalledWith(
      "admin_audit_log failed",
      expect.any(Error),
      expect.objectContaining({ action: "create_vendor", adminId: baseAdmin.id }),
    );
  });

  it("accepts VerifiedAdminJwt shape (admin objects with sub etc.)", async () => {
    mockQuery.mockResolvedValueOnce(qr());
    await logAdminAction(
      {
        id: "admin-2",
        email: "a2@x",
        name: "Other",
        role: "super_admin",
        sub: "admin-2",
      } as unknown as Parameters<typeof logAdminAction>[0],
      "x",
    );
    const params = mockQuery.mock.calls[0][1] as unknown[];
    expect(params[0]).toBe("admin-2");
    expect(params[1]).toBe("a2@x");
  });
});