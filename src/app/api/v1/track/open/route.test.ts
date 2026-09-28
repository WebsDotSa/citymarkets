import { describe, it, expect, vi, beforeEach } from "vitest";

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }));

vi.mock("@/lib/db", () => ({ pool: { query: queryMock } }));
vi.mock("@/lib/logger", () => ({
  error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn(),
}));

import { GET } from "./route";
import { signDeliveryToken } from "@/lib/broadcasts/sign";
import { NextRequest } from "next/server";

const DELIVERY = "11111111-1111-1111-1111-111111111111";

function makeReq(d: string | null): NextRequest {
  const url = new URL("http://x/api/v1/track/open");
  if (d) url.searchParams.set("d", d);
  return new NextRequest(url);
}

describe("GET /api/v1/track/open", () => {
  beforeEach(() => {
    queryMock.mockReset();
  });

  it("returns 400 when d missing", async () => {
    const res = await GET(makeReq(null));
    expect(res.status).toBe(400);
    expect(res.headers.get("Content-Type")).toBe("image/gif");
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("returns 400 on tampered token", async () => {
    const res = await GET(makeReq("garbage.token"));
    expect(res.status).toBe(400);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("returns 200 + 1x1 gif and records opened on valid token", async () => {
    const token = signDeliveryToken(DELIVERY);
    queryMock.mockResolvedValueOnce({ rows: [], rowCount: 1 });
    const res = await GET(makeReq(token));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/gif");
    expect(queryMock).toHaveBeenCalledTimes(1);
    const [sql, params] = queryMock.mock.calls[0];
    expect(sql).toMatch(/opened_at = COALESCE/);
    expect(sql).toMatch(/delivered_at = COALESCE/);
    expect(params).toEqual([DELIVERY]);
  });

  it("still returns the gif even when the DB write fails", async () => {
    const token = signDeliveryToken(DELIVERY);
    queryMock.mockRejectedValueOnce(new Error("db down"));
    const res = await GET(makeReq(token));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/gif");
  });

  it("rejects expired tokens", async () => {
    const token = signDeliveryToken(DELIVERY, -1);
    const res = await GET(makeReq(token));
    expect(res.status).toBe(400);
  });
});
