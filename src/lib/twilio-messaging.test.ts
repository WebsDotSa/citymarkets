import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const ORIGINAL = { ...process.env };

vi.mock("@/lib/twilio-config", () => ({
  getTwilioAccountSid: () => process.env.TWILIO_ACCOUNT_SID,
  getTwilioAuthToken: () => process.env.TWILIO_AUTH_TOKEN,
  getTwilioVerifyServiceSid: () => process.env.TWILIO_VERIFY_SERVICE_SID,
  getTwilioMessagingServiceSid: () => process.env.TWILIO_MESSAGING_SERVICE_SID,
  getTwilioAuthHeader: () => {
    const sid = process.env.TWILIO_ACCOUNT_SID;
    const token = process.env.TWILIO_AUTH_TOKEN;
    if (!sid || !token) throw new Error("twilio_not_configured");
    return "Basic " + Buffer.from(`${sid}:${token}`).toString("base64");
  },
  isTwilioVerifyConfigured: () => false,
  isTwilioMessagingConfigured: () =>
    Boolean(
      process.env.TWILIO_ACCOUNT_SID &&
        process.env.TWILIO_AUTH_TOKEN &&
        process.env.TWILIO_MESSAGING_SERVICE_SID,
    ),
  isTwilioConfigured: () => true,
}));

vi.mock("@/lib/logger", () => ({
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
}));

const mockFetch = vi.fn();

beforeEach(() => {
  process.env.TWILIO_ACCOUNT_SID = "ACtest";
  process.env.TWILIO_AUTH_TOKEN = "authtoken";
  process.env.TWILIO_MESSAGING_SERVICE_SID = "MGmsg";
  mockFetch.mockReset();
  globalThis.fetch = mockFetch as unknown as typeof fetch;
});

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL)) delete process.env[key];
  }
  for (const [k, v] of Object.entries(ORIGINAL)) {
    process.env[k] = v;
  }
});

describe("twilioSendSms", () => {
  it("returns twilio_messaging_not_configured when messaging is not set", async () => {
    delete process.env.TWILIO_MESSAGING_SERVICE_SID;
    const { twilioSendSms } = await import("./twilio-messaging");
    const out = await twilioSendSms("0500000000", "hi");
    expect(out).toEqual({
      ok: false,
      error: "twilio_messaging_not_configured",
    });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("returns invalid_phone when normalizeSaudiToE164 rejects the input", async () => {
    const { twilioSendSms } = await import("./twilio-messaging");
    const out = await twilioSendSms("not-a-phone", "hi");
    expect(out).toEqual({ ok: false, error: "invalid_phone" });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("POSTs to the Messages endpoint with E.164 number and SMS body", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => ({ sid: "SM123" }),
    });
    const { twilioSendSms } = await import("./twilio-messaging");
    const out = await twilioSendSms("0500000000", "hello");
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.sid).toBe("SM123");
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe(
      "https://api.twilio.com/2010-04-01/Accounts/ACtest/Messages.json",
    );
    expect(opts.body.get("To")).toBe("+966500000000");
    expect(opts.body.get("MessagingServiceSid")).toBe("MGmsg");
    expect(opts.body.get("Body")).toBe("hello");
  });

  it("truncates the body to 1600 characters", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => ({ sid: "x" }),
    });
    const { twilioSendSms } = await import("./twilio-messaging");
    const longBody = "a".repeat(2000);
    await twilioSendSms("0500000000", longBody);
    const body = mockFetch.mock.calls[0][1].body.get("Body") as string;
    expect(body.length).toBe(1600);
  });

  it("returns the Twilio error message on a non-ok response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({
        message: "invalid parameter",
        code: 21211,
      }),
    });
    const { twilioSendSms } = await import("./twilio-messaging");
    const out = await twilioSendSms("0500000000", "hi");
    expect(out).toEqual({
      ok: false,
      error: "invalid parameter",
      code: 21211,
    });
  });

  it("returns twilio_send_failed when the body is not parseable JSON", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 502,
      json: async () => {
        throw new Error("nope");
      },
    });
    const { twilioSendSms } = await import("./twilio-messaging");
    const out = await twilioSendSms("0500000000", "hi");
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toBe("twilio_send_failed");
  });

  it("returns empty sid string when the success body is missing sid", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({}),
    });
    const { twilioSendSms } = await import("./twilio-messaging");
    const out = await twilioSendSms("0500000000", "hi");
    expect(out).toEqual({ ok: true, sid: "" });
  });
});

describe("sendOrderConfirmationSms", () => {
  it("returns silently when messaging is not configured (no fetch)", async () => {
    delete process.env.TWILIO_MESSAGING_SERVICE_SID;
    const { sendOrderConfirmationSms } = await import("./twilio-messaging");
    await sendOrderConfirmationSms({
      phone: "0500000000",
      orderId: 42,
      total: 100,
    });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("does not throw when the underlying send fails", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ message: "boom" }),
    });
    const { sendOrderConfirmationSms } = await import("./twilio-messaging");
    await expect(
      sendOrderConfirmationSms({
        phone: "0500000000",
        orderId: 7,
        total: 50.5,
      }),
    ).resolves.toBeUndefined();
  });

  it("includes the order id and total in the localized message body", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => ({ sid: "OK" }),
    });
    const { sendOrderConfirmationSms } = await import("./twilio-messaging");
    await sendOrderConfirmationSms({
      phone: "0500000000",
      orderId: 99,
      total: 123.4,
    });
    const body = mockFetch.mock.calls[0][1].body.get("Body") as string;
    expect(body).toContain("#99");
    expect(body).toContain("123.40");
    expect(body).toContain("ر.س");
  });
});
