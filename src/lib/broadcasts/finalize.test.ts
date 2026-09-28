import { describe, it, expect, vi, beforeEach } from "vitest";

const { queryMock, releaseMock, connectMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  releaseMock: vi.fn(),
  connectMock: vi.fn(async () => ({ query: vi.fn(), release: vi.fn() })),
}));

vi.mock("@/lib/db", () => ({
  pool: {
    query: queryMock,
    connect: connectMock,
  },
}));

import { finalizeCompletedBroadcasts, timeoutStuckBroadcasts } from "./finalize";

describe("finalize.ts", () => {
  beforeEach(() => {
    queryMock.mockReset();
    releaseMock.mockReset();
  });

  it("flips broadcasts whose deliveries are all terminal", async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ id: "b-1" }, { id: "b-2" }], rowCount: 2 });
    const n = await finalizeCompletedBroadcasts();
    expect(n).toBe(2);
    expect(queryMock).toHaveBeenCalledWith(expect.stringContaining("UPDATE broadcasts"));
    expect(queryMock.mock.calls[0][0]).toMatch(/status='sending'/);
  });

  it("returns 0 when no broadcasts finalize", async () => {
    queryMock.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const n = await finalizeCompletedBroadcasts();
    expect(n).toBe(0);
  });

  it("marks broadcasts stuck in 'sending' past threshold as failed", async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ id: "b-9" }], rowCount: 1 });
    const n = await timeoutStuckBroadcasts(30);
    expect(n).toBe(1);
    const [sql, params] = queryMock.mock.calls[0];
    expect(sql).toMatch(/status='failed'/);
    expect(params).toEqual([30]);
  });

  it("default timeout uses 60 minutes", async () => {
    queryMock.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    await timeoutStuckBroadcasts();
    const [, params] = queryMock.mock.calls[0];
    expect(params).toEqual([60]);
  });
});
