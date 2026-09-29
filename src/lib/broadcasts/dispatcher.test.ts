import { describe, it, expect, vi, beforeEach } from "vitest";

const { queryMock, sendPushToUserMock, sendNativePushToUserMock, twilioSendSmsMock, sendEmailMock, publishToUserMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  sendPushToUserMock: vi.fn(),
  sendNativePushToUserMock: vi.fn(),
  twilioSendSmsMock: vi.fn(),
  sendEmailMock: vi.fn(),
  publishToUserMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ pool: { query: queryMock } }));
vi.mock("@/lib/push", () => ({ sendPushToUser: sendPushToUserMock }));
vi.mock("@/lib/native-push", () => ({ sendNativePushToUser: sendNativePushToUserMock }));
vi.mock("@/lib/twilio-messaging", () => ({ twilioSendSms: twilioSendSmsMock }));
vi.mock("@/lib/email", () => ({ sendEmail: sendEmailMock }));
vi.mock("@/lib/sse", () => ({ publishToUser: publishToUserMock }));
vi.mock("@/lib/logger", () => ({
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
}));

import { dispatchOne, type DeliveryRow } from "./dispatcher";

const delivery: DeliveryRow = {
  id: "d-1",
  broadcast_id: "b-1",
  user_id: "u-1",
  channel: "email",
};

const userRow: {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  loyalty_points: number | null;
  loyalty_tier: string | null;
} = {
  id: "u-1",
  name: "سارة",
  phone: "+966500000000",
  email: "sara@example.com",
  loyalty_points: 100,
  loyalty_tier: "gold",
};

const broadcastRow = (overrides: Record<string, unknown> = {}) => ({
  id: "b-1",
  title: "Hi {customer_name}",
  body: "You have {loyalty_points} pts",
  body_html: null,
  image_url: null,
  cta_label: null,
  cta_url: null,
  template_id: null,
  channels: ["email"],
  ...overrides,
});

const userRowNoContact = {
  id: "u-1",
  name: null,
  phone: null,
  email: null,
  loyalty_points: null,
  loyalty_tier: null,
};

function seed(broadcastOverrides: Record<string, unknown> = {}, user = userRow) {
  queryMock.mockResolvedValueOnce({ rows: [broadcastRow(broadcastOverrides)] });
  queryMock.mockResolvedValueOnce({ rows: [user] });
  queryMock.mockResolvedValueOnce({ rows: [] });
  queryMock.mockResolvedValueOnce({ rows: [], rowCount: 1 });
}

describe("dispatcher", () => {
  beforeEach(() => {
    queryMock.mockReset();
    sendPushToUserMock.mockReset();
    sendNativePushToUserMock.mockReset();
    twilioSendSmsMock.mockReset();
    sendEmailMock.mockReset();
    publishToUserMock.mockReset();
  });

  it("skips when broadcast is missing", async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    queryMock.mockResolvedValueOnce({ rows: [userRow] });
    queryMock.mockResolvedValueOnce({ rows: [], rowCount: 1 });
    await dispatchOne(delivery);
    const [sql, params] = queryMock.mock.calls.at(-1) as [string, unknown[]];
    expect(sql).toMatch(/status='skipped'/);
    expect(params[1]).toBe("broadcast_missing");
  });

  it("skips when user is missing", async () => {
    queryMock.mockResolvedValueOnce({ rows: [broadcastRow()] });
    queryMock.mockResolvedValueOnce({ rows: [] });
    queryMock.mockResolvedValueOnce({ rows: [], rowCount: 1 });
    await dispatchOne(delivery);
    const [sql, params] = queryMock.mock.calls.at(-1) as [string, unknown[]];
    expect(sql).toMatch(/status='skipped'/);
    expect(params[1]).toBe("user_missing");
  });

  it("dispatches web_push success", async () => {
    seed({ channels: ["web_push"] }, userRowNoContact);
    sendPushToUserMock.mockResolvedValueOnce({ sent: 1, failed: 0 });
    await dispatchOne({ ...delivery, channel: "web_push" });
    expect(sendPushToUserMock).toHaveBeenCalled();
    const [sql] = queryMock.mock.calls.at(-1) as [string, unknown[]];
    expect(sql).toMatch(/status='sent'/);
  });

  it("skips web_push when VAPID not configured", async () => {
    seed({ channels: ["web_push"] }, userRowNoContact);
    sendPushToUserMock.mockResolvedValueOnce({ sent: 0, failed: 0 });
    await dispatchOne({ ...delivery, channel: "web_push" });
    const [sql, params] = queryMock.mock.calls.at(-1) as [string, unknown[]];
    expect(sql).toMatch(/status='skipped'/);
    expect(params[1]).toBe("vapid_not_configured");
  });

  it("marks web_push failed when all pushes fail", async () => {
    seed({ channels: ["web_push"] }, userRowNoContact);
    sendPushToUserMock.mockResolvedValueOnce({ sent: 0, failed: 3 });
    await dispatchOne({ ...delivery, channel: "web_push" });
    const [sql, params] = queryMock.mock.calls.at(-1) as [string, unknown[]];
    expect(sql).toMatch(/status='failed'/);
    expect(params[1]).toBe("all_pushes_failed");
  });

  it("skips native_push when not configured", async () => {
    seed({ channels: ["native_push"] }, userRowNoContact);
    sendNativePushToUserMock.mockResolvedValueOnce({ skipped: true });
    await dispatchOne({ ...delivery, channel: "native_push" });
    const [sql, params] = queryMock.mock.calls.at(-1) as [string, unknown[]];
    expect(sql).toMatch(/status='skipped'/);
    expect(params[1]).toBe("native_push_not_configured");
  });

  it("skips native_push with sender_pending reason when sender is a stub", async () => {
    seed({ channels: ["native_push"] }, userRowNoContact);
    sendNativePushToUserMock.mockResolvedValueOnce({
      skipped: true,
      reason: "sender_not_implemented",
    });
    await dispatchOne({ ...delivery, channel: "native_push" });
    const [sql, params] = queryMock.mock.calls.at(-1) as [string, unknown[]];
    expect(sql).toMatch(/status='skipped'/);
    expect(params[1]).toBe("native_push_sender_pending");
  });

  it("skips native_push with no_tokens reason when user has no device registered", async () => {
    seed({ channels: ["native_push"] }, userRowNoContact);
    sendNativePushToUserMock.mockResolvedValueOnce({
      skipped: true,
      reason: "no_tokens",
    });
    await dispatchOne({ ...delivery, channel: "native_push" });
    const [sql, params] = queryMock.mock.calls.at(-1) as [string, unknown[]];
    expect(sql).toMatch(/status='skipped'/);
    expect(params[1]).toBe("native_push_no_tokens");
  });

  it("marks native_push sent on success", async () => {
    seed({ channels: ["native_push"] }, userRowNoContact);
    sendNativePushToUserMock.mockResolvedValueOnce({ skipped: false, failed: 0 });
    await dispatchOne({ ...delivery, channel: "native_push" });
    const [sql] = queryMock.mock.calls.at(-1) as [string, unknown[]];
    expect(sql).toMatch(/status='sent'/);
  });

  it("skips sms when user has no phone", async () => {
    seed({ channels: ["sms"] }, userRowNoContact);
    await dispatchOne({ ...delivery, channel: "sms" });
    const [sql, params] = queryMock.mock.calls.at(-1) as [string, unknown[]];
    expect(sql).toMatch(/status='skipped'/);
    expect(params[1]).toBe("no_phone");
  });

  it("dispatches sms success and stores external id", async () => {
    seed({ channels: ["sms"] }, { ...userRowNoContact, phone: "+9665" });
    twilioSendSmsMock.mockResolvedValueOnce({ ok: true, sid: "SM123" });
    await dispatchOne({ ...delivery, channel: "sms" });
    const [sql, params] = queryMock.mock.calls.at(-1) as [string, unknown[]];
    expect(sql).toMatch(/status='sent'/);
    expect(params).toContain("SM123");
  });

  it("marks sms failed when send errors", async () => {
    seed({ channels: ["sms"] }, { ...userRowNoContact, phone: "+9665" });
    twilioSendSmsMock.mockResolvedValueOnce({ ok: false, error: "twilio_down" });
    await dispatchOne({ ...delivery, channel: "sms" });
    const [sql, params] = queryMock.mock.calls.at(-1) as [string, unknown[]];
    expect(sql).toMatch(/status='failed'/);
    expect(params[1]).toBe("twilio_down");
  });

  it("skips email when user has no email", async () => {
    seed({ channels: ["email"] }, userRowNoContact);
    await dispatchOne({ ...delivery, channel: "email" });
    const [sql, params] = queryMock.mock.calls.at(-1) as [string, unknown[]];
    expect(sql).toMatch(/status='skipped'/);
    expect(params[1]).toBe("no_email");
  });

  it("dispatches email with interpolated subject/body, tracking pixel, and click-rewritten CTA", async () => {
    seed({ channels: ["email"], cta_url: "https://citymarkets.sa/offers", cta_label: "تسوق" });
    sendEmailMock.mockResolvedValueOnce({ ok: true, id: "em-1" });
    await dispatchOne(delivery);
    expect(sendEmailMock).toHaveBeenCalled();
    const call = sendEmailMock.mock.calls[0][0];
    expect(call.to).toBe("sara@example.com");
    expect(call.subject).toBe("Hi سارة");
    expect(call.text).toBe("You have 100 pts");
    // HTML must embed the signed open pixel + rewrite the CTA through the click tracker.
    expect(call.html).toMatch(/api\/v1\/track\/open\?d=/);
    expect(call.html).toMatch(/api\/v1\/track\/click\?d=.*&url=.*offers/);
    const [sql, params] = queryMock.mock.calls.at(-1) as [string, unknown[]];
    expect(sql).toMatch(/status='sent'/);
    expect(params).toContain("em-1");
  });

  it("marks email failed on send error", async () => {
    seed({ channels: ["email"] });
    sendEmailMock.mockResolvedValueOnce({ ok: false, error: "resend_500" });
    await dispatchOne(delivery);
    const [sql, params] = queryMock.mock.calls.at(-1) as [string, unknown[]];
    expect(sql).toMatch(/status='failed'/);
    expect(params[1]).toBe("resend_500");
  });

  it("publishes in_app and records sent", async () => {
    seed({ channels: ["in_app"] });
    await dispatchOne({ ...delivery, channel: "in_app" });
    expect(publishToUserMock).toHaveBeenCalledWith(
      "u-1",
      expect.objectContaining({ type: "broadcast" }),
    );
    const [sql] = queryMock.mock.calls.at(-1) as [string, unknown[]];
    expect(sql).toMatch(/status='sent'/);
  });

  it("records failed on unhandled exception", async () => {
    seed({ channels: ["email"] });
    sendEmailMock.mockRejectedValueOnce(new Error("boom"));
    await dispatchOne(delivery);
    const [sql, params] = queryMock.mock.calls.at(-1) as [string, unknown[]];
    expect(sql).toMatch(/status='failed'/);
    expect(params[1]).toBe("unhandled_exception");
  });
});
