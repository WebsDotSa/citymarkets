import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const ORIGINAL = { ...process.env };

describe("native-push", () => {
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

  it("isNativePushConfigured returns false when all env missing", async () => {
    delete process.env.APNS_KEY_ID;
    delete process.env.APNS_TEAM_ID;
    delete process.env.APNS_BUNDLE_ID;
    delete process.env.APNS_KEY_PATH;
    delete process.env.FCM_PROJECT_ID;
    delete process.env.FCM_SERVICE_ACCOUNT_JSON;
    delete process.env.FCM_SERVER_KEY;
    const { isNativePushConfigured } = await import("./native-push");
    expect(isNativePushConfigured()).toBe(false);
  });

  it("isNativePushConfigured returns true when APNs env present", async () => {
    process.env.APNS_KEY_ID = "k";
    process.env.APNS_TEAM_ID = "t";
    process.env.APNS_BUNDLE_ID = "b";
    process.env.APNS_KEY_PATH = "/p";
    const { isNativePushConfigured } = await import("./native-push");
    expect(isNativePushConfigured()).toBe(true);
  });

  it("isNativePushConfigured returns true when FCM legacy key present", async () => {
    process.env.FCM_SERVER_KEY = "k";
    const { isNativePushConfigured } = await import("./native-push");
    expect(isNativePushConfigured()).toBe(true);
  });

  it("sendNativePushToUser returns skipped when unconfigured", async () => {
    const { sendNativePushToUser } = await import("./native-push");
    const out = await sendNativePushToUser("u1", { title: "x", body: "y" });
    expect(out).toEqual({ sent: 0, failed: 0, skipped: true });
  });
});