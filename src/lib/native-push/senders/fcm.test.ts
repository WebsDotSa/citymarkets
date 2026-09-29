import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * FcmSender unit tests.
 *
 * Symmetric to `apns.test.ts` but covers the FCM env shape (project
 * id + service account JSON, OR legacy server key). The sender
 * implementation stays a placeholder until `firebase-admin` is added
 * as a dependency.
 */

const ORIGINAL = { ...process.env };

describe("FcmSender", () => {
  beforeEach(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in ORIGINAL)) delete process.env[key];
    }
    for (const [k, v] of Object.entries(ORIGINAL)) process.env[k] = v;
    vi.restoreAllMocks();
  });
  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in ORIGINAL)) delete process.env[key];
    }
    for (const [k, v] of Object.entries(ORIGINAL)) process.env[k] = v;
  });

  it("isConfigured returns false when env vars missing", async () => {
    delete process.env.FCM_PROJECT_ID;
    delete process.env.FCM_SERVICE_ACCOUNT_JSON;
    delete process.env.FCM_SERVER_KEY;
    vi.resetModules();
    const { FcmSender } = await import("./fcm");
    expect(new FcmSender().isConfigured()).toBe(false);
  });

  it("isConfigured returns true when FCM_PROJECT_ID + service account set", async () => {
    process.env.FCM_PROJECT_ID = "p";
    process.env.FCM_SERVICE_ACCOUNT_JSON = "{}";
    vi.resetModules();
    const { FcmSender } = await import("./fcm");
    expect(new FcmSender().isConfigured()).toBe(true);
  });

  it("isConfigured returns true when only legacy FCM_SERVER_KEY set", async () => {
    process.env.FCM_SERVER_KEY = "k";
    vi.resetModules();
    const { FcmSender } = await import("./fcm");
    expect(new FcmSender().isConfigured()).toBe(true);
  });

  it("describeConfiguration lists the FCM env vars", async () => {
    const { FcmSender } = await import("./fcm");
    expect(new FcmSender().describeConfiguration()).toMatch(/FCM_PROJECT_ID/);
  });

  it("send returns sender_not_implemented placeholder", async () => {
    const { FcmSender } = await import("./fcm");
    const sender = new FcmSender();
    const outcome = await sender.send({
      userId: "u-1",
      payload: { title: "t", body: "b" },
      tokens: [{ token: "tok", platform: "android" }],
    });
    expect(outcome).toEqual({
      status: "skipped",
      reason: "sender_not_implemented",
    });
  });
});
