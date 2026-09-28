import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Regression tests for /api/admin/employment (admin list + PATCH).
 *
 * The endpoint is gated by `requireAdminApi(_, "manage_store_settings")`.
 * We assert:
 *  - the gate is called with the correct permission
 *  - when the gate returns a 401/403 response, we propagate it
 *  - the GET filters by status / job_id / q when those query params
 *    are present, and excludes them otherwise
 *  - the GET also issues the per-status count summary
 *  - the PATCH rejects empty body and unknown status values
 *  - the PATCH stamps reviewed_by/reviewed_at when status changes away
 *    from 'new', and clears them when reverting to 'new'
 */

type QueryCall = { sql: string; params: unknown[] };
const calls: QueryCall[] = [];

let adminGate: "ok" | "unauth" | "forbid" = "ok";
let adminUser: { id: string } = { id: "admin-1" };

vi.mock("@/lib/db", () => ({
  pool: { connect: vi.fn() },
  query: vi.fn(async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    if (/SELECT status, COUNT/i.test(sql)) {
      return {
        rows: [
          { status: "new", count: 3 },
          { status: "reviewed", count: 1 },
        ],
      };
    }
    return { rows: [] };
  }),
}));

vi.mock("@/lib/admin-api-auth", () => ({
  requireAdminApi: vi.fn(async (_req: Request, perm: string) => {
    if (perm !== "manage_store_settings") {
      throw new Error(`unexpected permission: ${perm}`);
    }
    if (adminGate === "unauth") {
      return new (require("next/server").NextResponse)(
        JSON.stringify({ success: false, error: "auth" }),
        { status: 401 }
      );
    }
    if (adminGate === "forbid") {
      return new (require("next/server").NextResponse)(
        JSON.stringify({ success: false, error: "forbidden" }),
        { status: 403 }
      );
    }
    return { admin: adminUser };
  }),
}));

vi.mock("@/lib/logger", () => ({
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
}));

import { GET, PATCH } from "./route";

function getRequest(url: string): Request {
  return { headers: { get: () => null }, url } as unknown as Request;
}

function patchRequest(body: unknown): Request {
  return new Request("http://localhost/api/admin/employment", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("GET /api/admin/employment — admin list", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    calls.length = 0;
    adminGate = "ok";
  });

  it("returns 401 when the admin gate rejects the request", async () => {
    adminGate = "unauth";
    const res = await GET(getRequest("http://localhost/api/admin/employment") as never);
    expect(res.status).toBe(401);
  });

  it("queries the job_applications table and includes the count summary", async () => {
    const res = await GET(getRequest("http://localhost/api/admin/employment") as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.summary.counts.new).toBe(3);
    expect(body.summary.counts.reviewed).toBe(1);
    expect(body.summary.total).toBe(4);

    const selectAll = calls.find((c) =>
      /SELECT id, full_name/i.test(c.sql) && /ORDER BY created_at/i.test(c.sql)
    );
    expect(selectAll).toBeDefined();
    const summary = calls.find((c) => /GROUP BY status/i.test(c.sql));
    expect(summary).toBeDefined();
  });

  it("filters by status when ?status= is supplied", async () => {
    await GET(getRequest("http://localhost/api/admin/employment?status=reviewed") as never);
    const list = calls.find((c) => /ORDER BY created_at/i.test(c.sql));
    expect(list).toBeDefined();
    expect(list!.sql.toUpperCase()).toContain("STATUS = $1");
    expect(list!.params[0]).toBe("reviewed");
  });

  it("filters by job_id when ?job_id= is supplied", async () => {
    await GET(getRequest("http://localhost/api/admin/employment?job_id=delivery") as never);
    const list = calls.find((c) => /ORDER BY created_at/i.test(c.sql));
    expect(list!.sql.toUpperCase()).toContain("JOB_ID = $1");
    expect(list!.params[0]).toBe("delivery");
  });

  it("applies a fuzzy search across name/phone/email/job when ?q= is supplied", async () => {
    await GET(getRequest("http://localhost/api/admin/employment?q=محمد") as never);
    const list = calls.find((c) => /ORDER BY created_at/i.test(c.sql));
    expect(list!.sql.toUpperCase()).toContain("ILIKE");
    expect(list!.params[0]).toBe("%محمد%");
  });

  it("ignores unknown status values (treated as no filter)", async () => {
    await GET(getRequest("http://localhost/api/admin/employment?status=hacker") as never);
    const list = calls.find((c) => /ORDER BY created_at/i.test(c.sql));
    // No STATUS = $ placeholder added.
    expect(list!.sql.toUpperCase()).not.toContain("STATUS = $");
  });
});

describe("PATCH /api/admin/employment — review state", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    calls.length = 0;
    adminGate = "ok";
    adminUser = { id: "admin-1" };
  });

  it("rejects PATCH with no changes", async () => {
    const res = await PATCH(patchRequest({ id: "app-1" }) as never);
    expect(res.status).toBe(400);
  });

  it("rejects an unknown status value", async () => {
    const res = await PATCH(
      patchRequest({ id: "app-1", status: "definitely-not-valid" }) as never
    );
    expect(res.status).toBe(400);
  });

  it("stamps reviewed_by + reviewed_at when status moves away from 'new'", async () => {
    const res = await PATCH(
      patchRequest({ id: "app-1", status: "shortlisted" }) as never
    );
    expect(res.status).toBe(200);
    const update = calls.find((c) => c.sql.startsWith("UPDATE job_applications"));
    expect(update).toBeDefined();
    expect(update!.sql).toContain("status = $1");
    expect(update!.sql).toContain("reviewed_by = $2");
    expect(update!.sql).toContain("reviewed_at = NOW()");
    expect(update!.params[0]).toBe("shortlisted");
    expect(update!.params[1]).toBe("admin-1");
    expect(update!.params.at(-1)).toBe("app-1");
  });

  it("clears reviewed_by + reviewed_at when status reverts to 'new'", async () => {
    const res = await PATCH(
      patchRequest({ id: "app-1", status: "new", internal_notes: "ملاحظة" }) as never
    );
    expect(res.status).toBe(200);
    const update = calls.find((c) => c.sql.startsWith("UPDATE job_applications"));
    expect(update!.sql).toContain("reviewed_by = NULL");
    expect(update!.sql).toContain("reviewed_at = NULL");
  });

  it("persists internal_notes on its own without touching reviewer fields", async () => {
    const res = await PATCH(
      patchRequest({ id: "app-1", internal_notes: "متابعة لاحقا" }) as never
    );
    expect(res.status).toBe(200);
    const update = calls.find((c) => c.sql.startsWith("UPDATE job_applications"));
    expect(update!.sql).toContain("internal_notes = $1");
    expect(update!.sql).not.toContain("reviewed_by");
  });
});
