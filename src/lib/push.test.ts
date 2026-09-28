import { describe, it, expect, vi, beforeEach } from "vitest";

// The push module caches `configured`/`webpushModule` at module scope, so
// each test needs a fresh import of `./push`. We mock `web-push` (as namespace
// exports — push.ts calls webpushModule.setVapidDetails directly without
// unwrapping .default) and the db pool so the module's lazy imports route
// through our vi.fn shims.
const mockSetVapidDetails = vi.fn();
const mockSendNotification = vi.fn();
const mockPoolQuery = vi.fn();
const mockPoolConnect = vi.fn();

vi.mock("@/lib/db", () => ({
  pool: {
    connect: () => mockPoolConnect(),
  },
}));

vi.mock("web-push", () => ({
  setVapidDetails: (...args: unknown[]) => mockSetVapidDetails(...args),
  sendNotification: (...args: unknown[]) => mockSendNotification(...args),
}));

describe("push", () => {
  beforeEach(() => {
    mockSetVapidDetails.mockReset();
    mockSendNotification.mockReset();
    mockPoolQuery.mockReset();
    mockPoolConnect.mockReset();
    vi.resetModules();
    mockPoolConnect.mockImplementation(async () => ({
      query: mockPoolQuery,
      release: vi.fn(),
    }));
  });

  // Helper: import push AFTER beforeEach (so vi.resetModules applies) and
  // AFTER the test has set its env vars.
  const push = () => import("./push");

  describe("VAPID configuration", () => {
    it("returns vapid_not_configured when env vars are missing", async () => {
      delete process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      delete process.env.VAPID_PRIVATE_KEY;
      const mod = await push();
      const out = await mod.sendPushToEndpoint("e", "p", "a", {
        title: "t",
        body: "b",
      });
      expect(out).toEqual({ ok: false, reason: "vapid_not_configured" });
      expect(mockSendNotification).not.toHaveBeenCalled();
    });

    it("configures VAPID and sends when env vars are set", async () => {
      process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = "BPub";
      process.env.VAPID_PRIVATE_KEY = "priv-key";
      mockSendNotification.mockResolvedValueOnce({});
      const mod = await push();
      const out = await mod.sendPushToEndpoint(
        "https://push.example.com/sub/1",
        "p",
        "a",
        { title: "t", body: "b" },
      );
      expect(out.ok).toBe(true);
      expect(mockSetVapidDetails).toHaveBeenCalledTimes(1);
      expect(mockSendNotification).toHaveBeenCalledTimes(1);
    });

    it("uses the default subject when VAPID_SUBJECT is not set", async () => {
      process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = "BPub";
      process.env.VAPID_PRIVATE_KEY = "priv";
      delete process.env.VAPID_SUBJECT;
      mockSendNotification.mockResolvedValueOnce({});
      const mod = await push();
      await mod.sendPushToEndpoint("e", "p", "a", { title: "t", body: "b" });
      // web-push's setVapidDetails takes three positional args
      // (subject, publicKey, privateKey). The bundled types are wrong
      // (object stub) so push.ts casts through `any` — see comment in
      // src/lib/push.ts.
      expect(mockSetVapidDetails).toHaveBeenCalledTimes(1);
      const [subjectArg, pubArg, privArg] = mockSetVapidDetails.mock.calls[0];
      expect(subjectArg).toEqual(expect.stringContaining("mailto:"));
      expect(pubArg).toBe("BPub");
      expect(privArg).toBe("priv");
    });

    it("respects an explicit VAPID_SUBJECT", async () => {
      process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = "BPub";
      process.env.VAPID_PRIVATE_KEY = "priv";
      process.env.VAPID_SUBJECT = "mailto:test@example.com";
      mockSendNotification.mockResolvedValueOnce({});
      const mod = await push();
      await mod.sendPushToEndpoint("e", "p", "a", { title: "t", body: "b" });
      expect(mockSetVapidDetails).toHaveBeenCalledTimes(1);
      const [subjectArg, pubArg, privArg] = mockSetVapidDetails.mock.calls[0];
      expect(subjectArg).toBe("mailto:test@example.com");
      expect(pubArg).toBe("BPub");
      expect(privArg).toBe("priv");
    });
  });

  describe("sendPushToEndpoint", () => {
    beforeEach(() => {
      process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = "BPub";
      process.env.VAPID_PRIVATE_KEY = "priv";
    });

    it("returns { ok: true } when sendNotification resolves", async () => {
      mockSendNotification.mockResolvedValueOnce({});
      const mod = await push();
      const out = await mod.sendPushToEndpoint("e", "p", "a", {
        title: "t",
        body: "b",
      });
      expect(out.ok).toBe(true);
    });

    it("serializes the payload as JSON to the right endpoint", async () => {
      mockSendNotification.mockResolvedValueOnce({});
      const mod = await push();
      const payload = {
        title: "New order",
        body: "Order #42",
        url: "/orders/42",
        tag: "order-42",
      };
      await mod.sendPushToEndpoint(
        "https://push.example.com/sub/1",
        "p256dh-key",
        "auth-key",
        payload,
      );
      expect(mockSendNotification).toHaveBeenCalledWith(
        {
          endpoint: "https://push.example.com/sub/1",
          keys: { p256dh: "p256dh-key", auth: "auth-key" },
        },
        JSON.stringify(payload),
      );
    });

    it("returns the error statusCode and message on failure", async () => {
      const err = new Error("gone") as Error & { statusCode?: number };
      err.statusCode = 410;
      mockSendNotification.mockRejectedValueOnce(err);
      const mod = await push();
      const out = await mod.sendPushToEndpoint("e", "p", "a", {
        title: "t",
        body: "b",
      });
      expect(out.ok).toBe(false);
      expect(out.statusCode).toBe(410);
      expect(out.reason).toBe("gone");
    });

    it("falls back to 'send_failed' reason when error has no message", async () => {
      mockSendNotification.mockRejectedValueOnce({});
      const mod = await push();
      const out = await mod.sendPushToEndpoint("e", "p", "a", {
        title: "t",
        body: "b",
      });
      expect(out.ok).toBe(false);
      expect(out.reason).toBe("send_failed");
    });
  });

  describe("sendPushToUser", () => {
    beforeEach(() => {
      process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = "BPub";
      process.env.VAPID_PRIVATE_KEY = "priv";
    });

    it("returns sent=0/failed=0 when vapid is not configured", async () => {
      delete process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      delete process.env.VAPID_PRIVATE_KEY;
      const mod = await push();
      const out = await mod.sendPushToUser("u1", { title: "t", body: "b" });
      expect(out).toEqual({ sent: 0, failed: 0 });
      expect(mockPoolQuery).not.toHaveBeenCalled();
    });

    it("returns sent=0/failed=0 when the user has no subscriptions", async () => {
      mockPoolQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
      const mod = await push();
      const out = await mod.sendPushToUser("u1", { title: "t", body: "b" });
      expect(out).toEqual({ sent: 0, failed: 0 });
    });

    it("counts successes vs failures across all subscriptions", async () => {
      mockPoolQuery.mockResolvedValueOnce({
        rows: [
          { endpoint: "e1", p256dh: "p1", auth: "a1" },
          { endpoint: "e2", p256dh: "p2", auth: "a2" },
        ],
        rowCount: 2,
      });
      mockSendNotification
        .mockResolvedValueOnce({})
        .mockRejectedValueOnce(new Error("oops"));
      const mod = await push();
      const out = await mod.sendPushToUser("u1", { title: "t", body: "b" });
      expect(out).toEqual({ sent: 1, failed: 1 });
    });

    it("prunes 410/404 subscriptions from the DB", async () => {
      mockPoolQuery
        .mockResolvedValueOnce({
          rows: [{ endpoint: "e1", p256dh: "p1", auth: "a1" }],
          rowCount: 1,
        })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }); // DELETE
      const err410 = new Error("gone") as Error & { statusCode?: number };
      err410.statusCode = 410;
      mockSendNotification.mockRejectedValueOnce(err410);
      const mod = await push();
      const out = await mod.sendPushToUser("u1", { title: "t", body: "b" });
      expect(out.failed).toBe(1);
      const sqls = mockPoolQuery.mock.calls.map((c) => c[0] as string);
      expect(
        sqls.some((s) => /DELETE FROM push_subscriptions/i.test(s)),
      ).toBe(true);
    });

    it("does NOT prune on non-410/404 errors (transient failures stay)", async () => {
      mockPoolQuery.mockResolvedValueOnce({
        rows: [{ endpoint: "e1", p256dh: "p1", auth: "a1" }],
        rowCount: 1,
      });
      const err500 = new Error("server") as Error & { statusCode?: number };
      err500.statusCode = 500;
      mockSendNotification.mockRejectedValueOnce(err500);
      const mod = await push();
      await mod.sendPushToUser("u1", { title: "t", body: "b" });
      expect(mockPoolQuery).toHaveBeenCalledTimes(1);
      const sql = mockPoolQuery.mock.calls[0][0] as string;
      expect(sql).toMatch(/SELECT/i);
      expect(sql).not.toMatch(/DELETE/i);
    });
  });
});
