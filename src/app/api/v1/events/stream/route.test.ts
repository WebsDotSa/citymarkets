import { describe, it, expect, vi, beforeEach } from "vitest";

const { resolveMock, subscribeMock, heartbeatCommentMock } = vi.hoisted(() => ({
  resolveMock: vi.fn(),
  subscribeMock: vi.fn(),
  heartbeatCommentMock: vi.fn(),
}));

vi.mock('@/lib/identity', () => ({
  resolveCustomerUserIdFromRequest: resolveMock,
}));
vi.mock("@/lib/sse", () => ({
  subscribe: subscribeMock,
  heartbeatComment: heartbeatCommentMock,
}));

import { GET } from "./route";
import { NextRequest } from "next/server";

function makeReq(): NextRequest {
  return new NextRequest("http://x/api/v1/events/stream");
}

describe("GET /api/v1/events/stream", () => {
  beforeEach(() => {
    resolveMock.mockReset();
    subscribeMock.mockReset();
    heartbeatCommentMock.mockReset();
    subscribeMock.mockReturnValue(() => undefined);
  });

  it("returns 401 when not authenticated", async () => {
    resolveMock.mockResolvedValueOnce(null);
    const res = await GET(makeReq());
    expect(res.status).toBe(401);
  });

  it("returns 200 with text/event-stream when authenticated", async () => {
    resolveMock.mockResolvedValueOnce("u-1");
    const res = await GET(makeReq());
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/event-stream");
    expect(res.headers.get("Cache-Control")).toMatch(/no-cache/);
  });
});
