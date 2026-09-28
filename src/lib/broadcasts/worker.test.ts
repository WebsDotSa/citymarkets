import { describe, it, expect, vi, beforeEach } from "vitest";

const { queryMock, connectMock, dispatchOneMock, expandMock, finalizeMock, timeoutMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  connectMock: vi.fn(),
  dispatchOneMock: vi.fn(),
  expandMock: vi.fn(),
  finalizeMock: vi.fn(),
  timeoutMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  pool: {
    query: queryMock,
    connect: connectMock,
  },
}));
vi.mock("@/lib/logger", () => ({
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
}));
vi.mock("./audience", () => ({ expandBroadcastAudience: expandMock }));
vi.mock("./dispatcher", () => ({ dispatchOne: dispatchOneMock }));
vi.mock("./finalize", () => ({
  finalizeCompletedBroadcasts: finalizeMock,
  timeoutStuckBroadcasts: timeoutMock,
}));

import { processBroadcasts } from "./worker";

function newClient() {
  return { query: vi.fn(), release: vi.fn() };
}

describe("worker.processBroadcasts", () => {
  beforeEach(() => {
    queryMock.mockReset();
    connectMock.mockReset();
    dispatchOneMock.mockReset();
    expandMock.mockReset();
    finalizeMock.mockReset();
    timeoutMock.mockReset();
    expandMock.mockResolvedValue({
      inserted: 0,
      byChannel: { web_push: 0, native_push: 0, sms: 0, email: 0, in_app: 0 },
    });
    finalizeMock.mockResolvedValue(0);
    timeoutMock.mockResolvedValue(0);
  });

  it("promotes due broadcasts, expands audience, claims, dispatches, finalizes", async () => {
    const client = newClient();
    connectMock.mockResolvedValueOnce(client);
    client.query
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockResolvedValueOnce({ rows: [{ id: "b-1", audience: { type: "all" }, channels: ["email"] }], rowCount: 1 })
      .mockResolvedValueOnce(undefined); // COMMIT
    queryMock.mockResolvedValueOnce({
      rows: [{ id: "d-1", broadcast_id: "b-1", user_id: "u-1", channel: "email" }],
    });
    expandMock.mockResolvedValueOnce({
      inserted: 3,
      byChannel: { web_push: 0, native_push: 0, sms: 0, email: 3, in_app: 0 },
    });
    dispatchOneMock.mockResolvedValueOnce(undefined);
    finalizeMock.mockResolvedValueOnce(1);
    timeoutMock.mockResolvedValueOnce(0);

    await processBroadcasts();

    expect(expandMock).toHaveBeenCalledWith(client, "b-1", { type: "all" }, ["email"]);
    expect(dispatchOneMock).toHaveBeenCalledWith({
      id: "d-1", broadcast_id: "b-1", user_id: "u-1", channel: "email",
    });
    expect(finalizeMock).toHaveBeenCalled();
    expect(timeoutMock).toHaveBeenCalled();
    expect(client.release).toHaveBeenCalled();
  });

  it("skips overlapping ticks", async () => {
    let connectCount = 0;
    connectMock.mockImplementation(async () => {
      connectCount++;
      const client = newClient();
      // Slow BEGIN so the second call's `running` check fires first.
      client.query.mockImplementation(async (sql: string) => {
        if (sql === "BEGIN") await new Promise((r) => setTimeout(r, 8));
        if (sql.startsWith("UPDATE broadcasts")) {
          return { rows: [], rowCount: 0 };
        }
        return undefined;
      });
      return client;
    });
    queryMock.mockResolvedValue({ rows: [], rowCount: 0 });

    const p1 = processBroadcasts();
    const p2 = processBroadcasts();
    await Promise.all([p1, p2]);

    // Only one tick should have actually run a connect.
    expect(connectCount).toBe(1);
  });

  it("releases the client and clears the running flag on error", async () => {
    const client1 = newClient();
    const client2 = newClient();
    connectMock.mockResolvedValueOnce(client1).mockResolvedValueOnce(client2);

    client1.query
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockRejectedValueOnce(new Error("db down")); // UPDATE due
    client1.release.mockReturnValueOnce(undefined);

    await expect(processBroadcasts()).rejects.toThrow("db down");
    expect(client1.release).toHaveBeenCalled();

    // Second tick should run normally (running flag cleared).
    client2.query
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // UPDATE due
      .mockResolvedValueOnce(undefined); // COMMIT
    queryMock.mockResolvedValueOnce({ rows: [] });

    await expect(processBroadcasts()).resolves.toBeUndefined();
    expect(client2.release).toHaveBeenCalled();
  });

  it("continues dispatching after a single delivery throws", async () => {
    const client = newClient();
    connectMock.mockResolvedValueOnce(client);
    client.query
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // UPDATE due
      .mockResolvedValueOnce(undefined); // COMMIT
    queryMock.mockResolvedValueOnce({
      rows: [
        { id: "d-1", broadcast_id: "b-1", user_id: "u-1", channel: "email" },
        { id: "d-2", broadcast_id: "b-1", user_id: "u-2", channel: "sms" },
      ],
    });
    dispatchOneMock
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce(undefined);

    await processBroadcasts();
    expect(dispatchOneMock).toHaveBeenCalledTimes(2);
  });
});
