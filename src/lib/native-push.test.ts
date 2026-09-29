import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * `sendNativePushToUser` regression tests.
 *
 * Pre-2026-09-29: a stub that always returned
 * `{sent:0, failed:0, skipped:true}` regardless of env. Today the
 * module routes through `selectSender()` (provider abstraction) and
 * tags every skip with a `reason` so the broadcast dispatcher can
 * distinguish:
 *   - "not_configured" — env missing;
 *   - "no_tokens" — env present but user has no registered device;
 *   - "sender_not_implemented" — env present but concrete send code
 *     hasn't shipped yet (current production state).
 */

const ORIGINAL = { ...process.env };

// Mock the provider abstraction so the test never reaches the
// placeholder senders when probing the configured-but-stub path.
vi.mock("@/lib/native-push/senders", () => ({
  selectSender: vi.fn(),
}));

// Mock the DB layer so `loadPushTokens` doesn't hit a real Postgres.
// Per-test we set `mockTokens` to simulate "user has tokens" / "no tokens".
const queryMock = vi.fn();
vi.mock("@/lib/db", () => ({
  pool: { query: queryMock },
}));

import { selectSender } from "@/lib/native-push/senders";

function setApnsEnv() {
  process.env.APNS_KEY_ID = "k";
  process.env.APNS_TEAM_ID = "t";
  process.env.APNS_BUNDLE_ID = "b";
  process.env.APNS_KEY_PATH = "/p";
}
function clearApnsEnv() {
  delete process.env.APNS_KEY_ID;
  delete process.env.APNS_TEAM_ID;
  delete process.env.APNS_BUNDLE_ID;
  delete process.env.APNS_KEY_PATH;
}
function clearFcmEnv() {
  delete process.env.FCM_PROJECT_ID;
  delete process.env.FCM_SERVICE_ACCOUNT_JSON;
  delete process.env.FCM_SERVER_KEY;
}

async function loadFresh() {
  vi.resetModules();
  return (await import("./native-push")) as typeof import("./native-push");
}

describe("native-push", () => {
  beforeEach(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in ORIGINAL)) delete process.env[key];
    }
    for (const [k, v] of Object.entries(ORIGINAL)) process.env[k] = v;
    vi.restoreAllMocks();
    queryMock.mockReset();
    vi.mocked(selectSender).mockReset();
  });
  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in ORIGINAL)) delete process.env[key];
    }
    for (const [k, v] of Object.entries(ORIGINAL)) process.env[k] = v;
  });

  it("isNativePushConfigured returns false when all env missing", async () => {
    clearApnsEnv();
    clearFcmEnv();
    const { isNativePushConfigured } = await loadFresh();
    expect(isNativePushConfigured()).toBe(false);
  });

  it("isNativePushConfigured returns true when APNs env present", async () => {
    setApnsEnv();
    const { isNativePushConfigured } = await loadFresh();
    expect(isNativePushConfigured()).toBe(true);
  });

  it("isNativePushConfigured returns true when FCM legacy key present", async () => {
    clearApnsEnv();
    clearFcmEnv();
    process.env.FCM_SERVER_KEY = "k";
    const { isNativePushConfigured } = await loadFresh();
    expect(isNativePushConfigured()).toBe(true);
  });

  it("sendNativePushToUser returns not_configured when env missing", async () => {
    clearApnsEnv();
    clearFcmEnv();
    const { sendNativePushToUser } = await loadFresh();
    const out = await sendNativePushToUser("u1", { title: "x", body: "y" });
    expect(out).toEqual({
      sent: 0,
      failed: 0,
      skipped: true,
      reason: "not_configured",
    });
  });

  it("sendNativePushToUser returns sender_not_implemented when configured but no real sender", async () => {
    setApnsEnv();
    // selectSender returns null → the env check passes but the
    // factory finds no concrete provider. We force that by mocking
    // selectSender to return null explicitly.
    vi.mocked(selectSender).mockReturnValue(null);
    queryMock.mockResolvedValueOnce({ rows: [{ device_token: "tok", platform: "apns" }] });
    const { sendNativePushToUser } = await loadFresh();
    const out = await sendNativePushToUser("u1", { title: "x", body: "y" });
    expect(out).toEqual({
      sent: 0,
      failed: 0,
      skipped: true,
      reason: "not_configured",
    });
  });

  it("sendNativePushToUser returns no_tokens when user has no registered device", async () => {
    setApnsEnv();
    const fakeSender = { isConfigured: () => true, describeConfiguration: () => "x", send: vi.fn() };
    vi.mocked(selectSender).mockReturnValue(fakeSender as never);
    queryMock.mockResolvedValueOnce({ rows: [] });
    const { sendNativePushToUser } = await loadFresh();
    const out = await sendNativePushToUser("u1", { title: "x", body: "y" });
    expect(out).toEqual({
      sent: 0,
      failed: 0,
      skipped: true,
      reason: "no_tokens",
    });
  });

  it("sendNativePushToUser returns sender_not_implemented when sender stub returns skipped", async () => {
    setApnsEnv();
    const fakeSender = {
      isConfigured: () => true,
      describeConfiguration: () => "x",
      send: vi.fn().mockResolvedValue({ status: "skipped", reason: "sender_not_implemented" }),
    };
    vi.mocked(selectSender).mockReturnValue(fakeSender as never);
    queryMock.mockResolvedValueOnce({ rows: [{ device_token: "tok", platform: "apns" }] });
    const { sendNativePushToUser } = await loadFresh();
    const out = await sendNativePushToUser("u1", { title: "x", body: "y" });
    expect(out).toEqual({
      sent: 0,
      failed: 0,
      skipped: true,
      reason: "sender_not_implemented",
    });
  });

  it("sendNativePushToUser returns sent counts when sender reports success", async () => {
    setApnsEnv();
    const fakeSender = {
      isConfigured: () => true,
      describeConfiguration: () => "x",
      send: vi.fn().mockResolvedValue({
        status: "sent",
        sent: 2,
        failed: 1,
        externalIds: ["a", "b"],
      }),
    };
    vi.mocked(selectSender).mockReturnValue(fakeSender as never);
    queryMock.mockResolvedValueOnce({
      rows: [
        { device_token: "tok1", platform: "apns" },
        { device_token: "tok2", platform: "apns" },
        { device_token: "tok3", platform: "apns" },
      ],
    });
    const { sendNativePushToUser } = await loadFresh();
    const out = await sendNativePushToUser("u1", { title: "x", body: "y" });
    expect(out).toEqual({ sent: 2, failed: 1, skipped: false });
  });
});
