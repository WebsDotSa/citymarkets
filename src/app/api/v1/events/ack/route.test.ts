import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

const { resolveMock, queryMock } = vi.hoisted(() => ({
  resolveMock: vi.fn(),
  queryMock: vi.fn(),
}));

vi.mock('@/lib/identity', () => ({
  resolveCustomerUserIdFromRequest: resolveMock,
}));
vi.mock("@/lib/db", () => ({ pool: { query: queryMock } }));
vi.mock("@/lib/logger", () => ({
  error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn(),
}));

import { POST } from "./route";

const DELIVERY = "11111111-1111-1111-1111-111111111111";

function makeReq(body: unknown): NextRequest {
  return {
    headers: { get: () => null },
    url: "http://x/api/v1/events/ack",
    json: async () => body,
  } as unknown as NextRequest;
}

describe("POST /api/v1/events/ack", () => {
  beforeEach(() => {
    resolveMock.mockReset();
    queryMock.mockReset();
    resolveMock.mockResolvedValue("u-1");
  });

  it("returns 401 when not authenticated", async () => {
    resolveMock.mockResolvedValueOnce(null);
    const res = await POST(makeReq({ delivery_id: DELIVERY }));
    expect(res.status).toBe(401);
  });

  it("returns 400 on invalid JSON", async () => {
    const res = await POST({
      headers: { get: () => null },
      url: "http://x",
      json: async () => { throw new Error("bad"); },
    } as unknown as NextRequest);
    expect(res.status).toBe(400);
  });

  it("returns 400 on validation failure", async () => {
    const res = await POST(makeReq({ delivery_id: "not-a-uuid" }));
    expect(res.status).toBe(400);
  });

  it("returns 404 when delivery not owned by user", async () => {
    queryMock.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const res = await POST(makeReq({ delivery_id: DELIVERY, state: "delivered" }));
    expect(res.status).toBe(404);
  });

  it("sets delivered_at on success", async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [{ "?column?": 1 }], rowCount: 1 }) // ownership
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }); // UPDATE
    const res = await POST(makeReq({ delivery_id: DELIVERY, state: "delivered" }));
    expect(res.status).toBe(200);
    const [, params] = queryMock.mock.calls[1];
    expect((queryMock.mock.calls[1][0] as string)).toMatch(/delivered_at = COALESCE/);
    expect(params).toEqual([DELIVERY]);
  });

  it("sets opened_at when state=opened", async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [{ "?column?": 1 }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });
    const res = await POST(makeReq({ delivery_id: DELIVERY, state: "opened" }));
    expect(res.status).toBe(200);
    expect((queryMock.mock.calls[1][0] as string)).toMatch(/opened_at = COALESCE/);
  });

  it("returns 500 on DB error", async () => {
    queryMock.mockRejectedValueOnce(new Error("db down"));
    const res = await POST(makeReq({ delivery_id: DELIVERY }));
    expect(res.status).toBe(500);
  });
});
