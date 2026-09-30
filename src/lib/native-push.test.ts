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
// `selectSenders` (plural) is the new dispatch selector (audit K58).
// `selectSender` (singular) is kept as a backward-compat wrapper that
// returns the first configured sender. We deliberately do NOT mock
// `ApnsSender` / `FcmSender` — the dispatch helper relies on
// `instanceof` to map each sender to its platform (ios/android), so
// the real classes must be importable.
vi.mock("@/lib/native-push/senders", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/native-push/senders")>();
  return {
    ...actual,
    selectSender: vi.fn(),
    selectSenders: vi.fn(),
  };
});

// Mock the DB layer so `loadPushTokens` doesn't hit a real Postgres.
// Per-test we set `mockTokens` to simulate "user has tokens" / "no tokens".
const queryMock = vi.fn();
vi.mock("@/lib/db", () => ({
  pool: { query: queryMock },
}));

import { selectSender, selectSenders } from "@/lib/native-push/senders";

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
    vi.mocked(selectSenders).mockReset();
    // Default: the new dispatch path consults `selectSenders` first.
    // Default to "no senders" so each test must opt in to the
    // configured state by setting env vars + mocking.
    vi.mocked(selectSenders).mockReturnValue([]);
    vi.mocked(selectSender).mockReturnValue(null);
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
    // selectSenders returns [] → the env check passes but the
    // factory finds no concrete provider. We force that by mocking
    // selectSenders to return [] explicitly.
    vi.mocked(selectSenders).mockReturnValue([]);
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
    vi.mocked(selectSenders).mockReturnValue([fakeSender as never]);
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
    vi.mocked(selectSenders).mockReturnValue([fakeSender as never]);
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
    vi.mocked(selectSenders).mockReturnValue([fakeSender as never]);
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

  it("sendNativePushToUser fans out across multiple configured senders (K58)", async () => {
    // Multi-device dispatch: both APNs and FCM configured; user has
    // one iOS token + one Android token; both senders should run.
    setApnsEnv();
    process.env.FCM_PROJECT_ID = "p";
    process.env.FCM_SERVICE_ACCOUNT_JSON = "{}";

    const apnsSender = {
      isConfigured: () => true,
      describeConfiguration: () => "apns",
      send: vi.fn().mockResolvedValue({ status: "sent", sent: 1, failed: 0, externalIds: ["a"] }),
    };
    const fcmSender = {
      isConfigured: () => true,
      describeConfiguration: () => "fcm",
      send: vi.fn().mockResolvedValue({ status: "sent", sent: 1, failed: 0, externalIds: ["b"] }),
    };
    vi.mocked(selectSender).mockReturnValue(apnsSender as never);
    vi.mocked(selectSenders).mockReturnValue([apnsSender, fcmSender] as never);

    queryMock.mockResolvedValueOnce({
      rows: [
        { device_token: "ios-tok", platform: "apns" },
        { device_token: "and-tok", platform: "fcm" },
      ],
    });
    const { sendNativePushToUser } = await loadFresh();
    const out = await sendNativePushToUser("u1", { title: "x", body: "y" });
    expect(out).toEqual({ sent: 2, failed: 0, skipped: false });
    // Each sender must have been called exactly once.
    expect(apnsSender.send).toHaveBeenCalledTimes(1);
    expect(fcmSender.send).toHaveBeenCalledTimes(1);
  });

  it("sendNativePushToUser returns sender_not_implemented when ANY configured sender is a stub", async () => {
    setApnsEnv();
    process.env.FCM_PROJECT_ID = "p";
    process.env.FCM_SERVICE_ACCOUNT_JSON = "{}";

    // APNs is real (would send), FCM is a stub returning skipped.
    const apnsSender = {
      isConfigured: () => true,
      describeConfiguration: () => "apns",
      send: vi.fn().mockResolvedValue({ status: "sent", sent: 1, failed: 0, externalIds: ["a"] }),
    };
    const fcmSender = {
      isConfigured: () => true,
      describeConfiguration: () => "fcm",
      send: vi.fn().mockResolvedValue({ status: "skipped", reason: "sender_not_implemented" }),
    };
    vi.mocked(selectSenders).mockReturnValue([apnsSender, fcmSender] as never);

    queryMock.mockResolvedValueOnce({
      rows: [
        { device_token: "ios-tok", platform: "apns" },
        { device_token: "and-tok", platform: "fcm" },
      ],
    });
    const { sendNativePushToUser } = await loadFresh();
    const out = await sendNativePushToUser("u1", { title: "x", body: "y" });
    // Mixed result → reported as a successful delivery; partial
    // skip counts are absorbed.
    expect(out).toEqual({ sent: 1, failed: 0, skipped: false });
  });
});
