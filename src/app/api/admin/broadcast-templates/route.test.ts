import { describe, it, expect, vi, beforeEach } from "vitest";

type QueryResult = { rows: unknown[] };
const queryCalls: { sql: string; params: unknown[] }[] = [];

vi.mock("@/lib/db", () => ({
  pool: {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      queryCalls.push({ sql, params });
      if (/INSERT\s+INTO\s+broadcast_templates/i.test(sql) && /RETURNING\s+id/i.test(sql)) {
        return { rows: [{ id: "template-1" }] } as QueryResult;
      }
      return { rows: [] } as QueryResult;
    }),
    connect: vi.fn(),
  },
}));

vi.mock('@/lib/identity', () => ({  }));
vi.mock('@/lib/identity/admin-api-auth-db', () => ({ requireAdminApi: vi.fn(), }));


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
import { requireAdminApi } from "@/lib/identity/admin-api-auth-db";
function makeReq(url: string, body?: unknown): Request {
  return {
    headers: { get: () => null },
    url,
    json: async () => body,
  } as unknown as Request;
}

describe("/api/admin/broadcast-templates", () => {
  beforeEach(() => {
    queryCalls.length = 0;
    vi.mocked(requireAdminApi).mockResolvedValue({
      admin: { id: "admin-1", email: "x@y.z", role: "super_admin", tokenVersion: 1 },
    });
  });

  it("GET returns 200 with array", async () => {
    const res = await GET(makeReq("http://x/api/admin/broadcast-templates") as never);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(Array.isArray(data.data)).toBe(true);
  });

  it("POST persists template when content covers every channel", async () => {
    const res = await POST(
      makeReq("http://x/api/admin/broadcast-templates", {
        name: "Welcome",
        channels: ["email", "web_push"],
        content: {
          email: { subject: "Hi", html: "<p>x</p>" },
          web_push: { title: "Hi", body: "Hi" },
        },
        variables: ["customer_name"],
      }) as never,
    );
    expect(res.status).toBe(200);
  });

  it("POST returns 400 when content missing a channel", async () => {
    const res = await POST(
      makeReq("http://x/api/admin/broadcast-templates", {
        name: "Welcome",
        channels: ["email", "web_push"],
        content: { email: { subject: "Hi", html: "<p/>" } },
        variables: [],
      }) as never,
    );
    expect(res.status).toBe(400);
  });

  it("POST rejects invalid variables", async () => {
    const res = await POST(
      makeReq("http://x/api/admin/broadcast-templates", {
        name: "x",
        channels: ["email"],
        content: { email: { subject: "Hi", html: "<p/>" } },
        variables: ["bad-name!"],
      }) as never,
    );
    expect(res.status).toBe(400);
  });
});