import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * ApnsSender unit tests.
 *
 * - `isConfigured()` reflects the APNS_* env var set.
 * - `send()` returns `{status:"skipped", reason:"sender_not_implemented"}`
 *   until a real APNs HTTP/2 client lands.
 *
 * The env state is reset between tests so the loader function
 * (`isApnsConfigured` from `@/lib/env`) re-evaluates against the
 * fixtures each time.
 */

const ORIGINAL = { ...process.env };

describe("ApnsSender", () => {
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
    delete process.env.APNS_KEY_ID;
    delete process.env.APNS_TEAM_ID;
    delete process.env.APNS_BUNDLE_ID;
    delete process.env.APNS_KEY_PATH;
    vi.resetModules();
    const { ApnsSender } = await import("./apns");
    expect(new ApnsSender().isConfigured()).toBe(false);
  });

  it("isConfigured returns true when APNS env fully present", async () => {
    process.env.APNS_KEY_ID = "k";
    process.env.APNS_TEAM_ID = "t";
    process.env.APNS_BUNDLE_ID = "b";
    process.env.APNS_KEY_PATH = "/p";
    vi.resetModules();
    const { ApnsSender } = await import("./apns");
    expect(new ApnsSender().isConfigured()).toBe(true);
  });

  it("describeConfiguration lists the required env vars", async () => {
    const { ApnsSender } = await import("./apns");
    expect(new ApnsSender().describeConfiguration()).toMatch(
      /APNS_KEY_ID.*APNS_TEAM_ID.*APNS_BUNDLE_ID.*APNS_KEY_PATH/,
    );
  });

  it("send returns sender_not_implemented placeholder", async () => {
    const { ApnsSender } = await import("./apns");
    const sender = new ApnsSender();
    const outcome = await sender.send({
      userId: "u-1",
      payload: { title: "t", body: "b" },
      tokens: [{ token: "tok", platform: "ios" }],
    });
    expect(outcome).toEqual({
      status: "skipped",
      reason: "sender_not_implemented",
    });
  });
});
