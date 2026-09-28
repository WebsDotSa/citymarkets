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

function makeReq(d: string | null, url: string | null): NextRequest {
  const u = new URL("http://citymarkets.sa/api/v1/track/click");
  if (d) u.searchParams.set("d", d);
  if (url) u.searchParams.set("url", url);
  return new NextRequest(u);
}

describe("GET /api/v1/track/click", () => {
  beforeEach(() => {
    queryMock.mockReset();
  });

  it("returns 400 when params missing", async () => {
    const res = await GET(makeReq(null, null));
    expect(res.status).toBe(400);
  });

  it("returns 400 on tampered token", async () => {
    const res = await GET(makeReq("bad.token", "/x"));
    expect(res.status).toBe(400);
  });

  it("302 redirects to a same-origin path", async () => {
    const token = signDeliveryToken(DELIVERY);
    queryMock.mockResolvedValueOnce({ rows: [], rowCount: 1 });
    const res = await GET(makeReq(token, "/offers"));
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toContain("/offers");
    expect(queryMock).toHaveBeenCalledTimes(1);
  });

  it("302 redirects to an allowed external host", async () => {
    const token = signDeliveryToken(DELIVERY);
    queryMock.mockResolvedValueOnce({ rows: [], rowCount: 1 });
    const res = await GET(makeReq(token, "https://citymarkets.sa/blog"));
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toContain("citymarkets.sa/blog");
  });

  it("rejects a non-allowlisted external host", async () => {
    const token = signDeliveryToken(DELIVERY);
    queryMock.mockResolvedValueOnce({ rows: [], rowCount: 1 });
    const res = await GET(makeReq(token, "https://evil.example.com/x"));
    expect(res.status).toBe(400);
  });

  it("rejects protocol-relative path traversal", async () => {
    const token = signDeliveryToken(DELIVERY);
    queryMock.mockResolvedValueOnce({ rows: [], rowCount: 1 });
    const res = await GET(makeReq(token, "//evil.example/x"));
    expect(res.status).toBe(400);
  });

  it("rejects backslash trick", async () => {
    const token = signDeliveryToken(DELIVERY);
    queryMock.mockResolvedValueOnce({ rows: [], rowCount: 1 });
    const res = await GET(makeReq(token, "/\\evil.example"));
    expect(res.status).toBe(400);
  });

  it("still records the click when the destination is invalid", async () => {
    const token = signDeliveryToken(DELIVERY);
    queryMock.mockResolvedValueOnce({ rows: [], rowCount: 1 });
    const res = await GET(makeReq(token, "not-a-url"));
    // The metric should still be recorded; the user gets a 400.
    expect(queryMock).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(400);
  });

  it("still 302s when the DB write fails", async () => {
    const token = signDeliveryToken(DELIVERY);
    queryMock.mockRejectedValueOnce(new Error("db down"));
    const res = await GET(makeReq(token, "/x"));
    expect(res.status).toBe(302);
  });
});
