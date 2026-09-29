import { describe, it, expect, vi, beforeEach } from "vitest";

type QueryResult = { rows: unknown[] };
const queryCalls: { sql: string; params: unknown[] }[] = [];

vi.mock("@/lib/db", () => ({
  pool: {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      queryCalls.push({ sql, params });
      // INSERT ... RETURNING id returns a row with a synthetic id.
      if (/INSERT\s+INTO\s+broadcasts/i.test(sql) && /RETURNING\s+id/i.test(sql)) {
        return { rows: [{ id: "broadcast-1" }] } as QueryResult;
      }
      return { rows: [] } as QueryResult;
    }),
    connect: vi.fn(),
  },
}));

vi.mock('@/lib/identity', () => ({
  requireAdminApi: vi.fn(),
}));

vi.mock("@/lib/admin-audit", () => ({
  logAdminAction: vi.fn(),
}));

vi.mock("@/lib/logger", () => ({
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
}));

import { GET, POST } from "./route";
import { requireAdminApi } from '@/lib/identity';

function makeReq(url: string, body?: unknown): Request {
  const init: RequestInit = body ? { method: "POST", body: JSON.stringify(body) } : {};
  return { headers: { get: () => null }, url, json: async () => body } as unknown as Request;
}

describe("/api/admin/broadcasts", () => {
  beforeEach(() => {
    queryCalls.length = 0;
    vi.mocked(requireAdminApi).mockResolvedValue({
      admin: { id: "admin-1", email: "x@y.z", role: "super_admin" },
    });
  });

  it("GET returns 403 when admin lacks manage_broadcasts", async () => {
    const { NextResponse } = await import("next/server");
    vi.mocked(requireAdminApi).mockResolvedValueOnce(
      NextResponse.json({ success: false, error: "forbidden" }, { status: 403 }) as never,
    );
    const res = await GET(makeReq("http://x/api/admin/broadcasts") as never);
    expect(res.status).toBe(403);
  });

  it("GET lists broadcasts paginated", async () => {
    const res = await GET(makeReq("http://x/api/admin/broadcasts?page=1&limit=20") as never);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(Array.isArray(data.data)).toBe(true);
    expect(queryCalls.some((c) => /FROM\s+broadcasts/.test(c.sql))).toBe(true);
  });

  it("POST persists a draft broadcast and writes audit row", async () => {
    const res = await POST(
      makeReq("http://x/api/admin/broadcasts", {
        title: "Welcome",
        body: "Hi",
        channels: ["email"],
        audience: { type: "all" },
      }) as never,
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.data.id).toBeDefined();
  });

  it("POST returns 400 on invalid channels", async () => {
    const res = await POST(
      makeReq("http://x/api/admin/broadcasts", {
        title: "x",
        body: "y",
        channels: ["bogus"],
        audience: { type: "all" },
      }) as never,
    );
    expect(res.status).toBe(400);
  });

  it("POST returns 400 when audience is missing type", async () => {
    const res = await POST(
      makeReq("http://x/api/admin/broadcasts", {
        title: "x",
        body: "y",
        channels: ["email"],
        audience: {},
      }) as never,
    );
    expect(res.status).toBe(400);
  });
});