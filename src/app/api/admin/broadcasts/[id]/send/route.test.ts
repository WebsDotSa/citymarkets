import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

const { queryMock, connectMock, requireAdminApiMock, checkRateLimitMock, logAdminActionMock, expandMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  connectMock: vi.fn(),
  requireAdminApiMock: vi.fn(),
  checkRateLimitMock: vi.fn(),
  logAdminActionMock: vi.fn(),
  expandMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  pool: { query: queryMock, connect: connectMock },
}));
vi.mock("@/lib/admin-api-auth", () => ({ requireAdminApi: requireAdminApiMock }));
vi.mock("@/lib/admin-audit", () => ({ logAdminAction: logAdminActionMock }));
vi.mock("@/lib/logger", () => ({
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
}));
vi.mock("@/lib/rate-limit", () => ({
  BROADCAST_SEND_CONFIG: { windowMs: 600_000, max: 10 },
  BROADCAST_SEND_IP_CONFIG: { windowMs: 600_000, max: 20 },
  checkRateLimit: checkRateLimitMock,
  createRateLimitHeaders: () => ({}),
}));
vi.mock("@/lib/request-ip", () => ({ getClientIp: () => "127.0.0.1" }));
vi.mock("@/lib/broadcasts/audience", () => ({ expandBroadcastAudience: expandMock }));

import { POST } from "./route";

const admin = { id: "admin-1", email: "x@y.z", role: "super_admin" };

function makeReq(): NextRequest {
  return { headers: { get: () => null }, url: "http://x/api" } as unknown as NextRequest;
}

describe("POST /api/admin/broadcasts/[id]/send", () => {
  beforeEach(() => {
    queryMock.mockReset();
    connectMock.mockReset();
    requireAdminApiMock.mockReset();
    checkRateLimitMock.mockReset();
    logAdminActionMock.mockReset();
    expandMock.mockReset();

    requireAdminApiMock.mockResolvedValue({ admin });
    checkRateLimitMock.mockResolvedValue({ allowed: true, remaining: 5 });
  });

  it("returns 403 when admin lacks permission", async () => {
    const { NextResponse } = await import("next/server");
    requireAdminApiMock.mockResolvedValueOnce(NextResponse.json({ success: false }, { status: 403 }));
    const res = await POST(makeReq(), { params: Promise.resolve({ id: "11111111-1111-1111-1111-111111111111" }) });
    expect(res.status).toBe(403);
  });

  it("returns 429 when rate limited", async () => {
    checkRateLimitMock.mockResolvedValueOnce({ allowed: false, remaining: 0 });
    const res = await POST(makeReq(), { params: Promise.resolve({ id: "11111111-1111-1111-1111-111111111111" }) });
    expect(res.status).toBe(429);
  });

  it("returns 400 for malformed id", async () => {
    const res = await POST(makeReq(), { params: Promise.resolve({ id: "not-a-uuid" }) });
    expect(res.status).toBe(400);
  });

  it("returns 404 when broadcast missing", async () => {
    const client = { query: vi.fn(), release: vi.fn() };
    connectMock.mockResolvedValueOnce(client);
    client.query
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // SELECT
      .mockResolvedValueOnce(undefined); // ROLLBACK
    const res = await POST(makeReq(), { params: Promise.resolve({ id: "11111111-1111-1111-1111-111111111111" }) });
    expect(res.status).toBe(404);
    expect(client.release).toHaveBeenCalled();
  });

  it("returns 409 when broadcast is already sending", async () => {
    const client = { query: vi.fn(), release: vi.fn() };
    connectMock.mockResolvedValueOnce(client);
    client.query
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockResolvedValueOnce({ rows: [{ status: "sending", scheduled_at: null, audience: { type: "all" }, channels: ["email"] }], rowCount: 1 })
      .mockResolvedValueOnce(undefined); // ROLLBACK
    const res = await POST(makeReq(), { params: Promise.resolve({ id: "11111111-1111-1111-1111-111111111111" }) });
    expect(res.status).toBe(409);
  });

  it("flips to scheduled when scheduled_at is in the future", async () => {
    const client = { query: vi.fn(), release: vi.fn() };
    connectMock.mockResolvedValueOnce(client);
    client.query
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockResolvedValueOnce({ rows: [{ status: "draft", scheduled_at: new Date(Date.now() + 3600_000).toISOString(), audience: { type: "all" }, channels: ["email"] }], rowCount: 1 })
      .mockResolvedValueOnce(undefined) // UPDATE scheduled
      .mockResolvedValueOnce(undefined); // COMMIT
    const res = await POST(makeReq(), { params: Promise.resolve({ id: "11111111-1111-1111-1111-111111111111" }) });
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.status).toBe("scheduled");
    expect(expandMock).not.toHaveBeenCalled();
  });

  it("flips to sending and expands audience inline for immediate sends", async () => {
    const client = { query: vi.fn(), release: vi.fn() };
    connectMock.mockResolvedValueOnce(client);
    client.query
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockResolvedValueOnce({ rows: [{ status: "draft", scheduled_at: null, audience: { type: "all" }, channels: ["email", "sms"] }], rowCount: 1 })
      .mockResolvedValueOnce(undefined) // UPDATE sending
      .mockResolvedValueOnce(undefined); // COMMIT
    expandMock.mockResolvedValueOnce({ inserted: 2, byChannel: { web_push: 0, native_push: 0, sms: 1, email: 1, in_app: 0 } });

    const res = await POST(makeReq(), { params: Promise.resolve({ id: "11111111-1111-1111-1111-111111111111" }) });
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.status).toBe("sending");
    expect(expandMock).toHaveBeenCalledWith(
      client,
      "11111111-1111-1111-1111-111111111111",
      { type: "all" },
      ["email", "sms"],
    );
    expect(logAdminActionMock).toHaveBeenCalled();
  });

  it("returns 500 and rolls back on failure", async () => {
    const client = { query: vi.fn(), release: vi.fn() };
    connectMock.mockResolvedValueOnce(client);
    client.query
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockResolvedValueOnce({ rows: [{ status: "draft", scheduled_at: null, audience: { type: "all" }, channels: ["email"] }], rowCount: 1 })
      .mockRejectedValueOnce(new Error("db down")) // UPDATE sending fails
      .mockResolvedValueOnce(undefined); // ROLLBACK recovery
    const res = await POST(makeReq(), { params: Promise.resolve({ id: "11111111-1111-1111-1111-111111111111" }) });
    expect(res.status).toBe(500);
    expect(client.release).toHaveBeenCalled();
  });
});
