import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const ORIGINAL = { ...process.env };

// Mock the config so we can control env without touching global state.
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
  isTwilioVerifyConfigured: () =>
    Boolean(
      process.env.TWILIO_ACCOUNT_SID &&
        process.env.TWILIO_AUTH_TOKEN &&
        process.env.TWILIO_VERIFY_SERVICE_SID,
    ),
  isTwilioMessagingConfigured: () => false,
  isTwilioConfigured: () => true,
}));

// Mock logger to silence test output.
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
  process.env.TWILIO_VERIFY_SERVICE_SID = "VSverify";
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

describe("twilioSendVerification", () => {
  it("throws twilio_not_configured when no verify service sid", async () => {
    delete process.env.TWILIO_VERIFY_SERVICE_SID;
    const { twilioSendVerification } = await import("./twilio-verify");
    await expect(twilioSendVerification("+966500000000")).rejects.toThrow(
      /twilio_not_configured/,
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("POSTs to the Verifications endpoint with SMS channel", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) });
    const { twilioSendVerification } = await import("./twilio-verify");
    await twilioSendVerification("+966500000000");
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe(
      "https://verify.twilio.com/v2/Services/VSverify/Verifications",
    );
    expect(opts.method).toBe("POST");
    expect(opts.headers.Authorization).toMatch(/^Basic /);
    expect(opts.body.get("To")).toBe("+966500000000");
    expect(opts.body.get("Channel")).toBe("sms");
  });

  it("throws twilio_send_failed:<code> on a non-ok response with a Twilio code", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({ message: "bad", code: 60203 }),
    });
    const { twilioSendVerification } = await import("./twilio-verify");
    await expect(twilioSendVerification("+966500000000")).rejects.toThrow(
      "twilio_send_failed:60203",
    );
  });

  it("falls back to the HTTP status code when no Twilio error code is present", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ message: "boom" }),
    });
    const { twilioSendVerification } = await import("./twilio-verify");
    await expect(twilioSendVerification("+966500000000")).rejects.toThrow(
      "twilio_send_failed:500",
    );
  });

  it("uses the response text when the body isn't JSON", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 502,
      json: async () => {
        throw new Error("not json");
      },
      text: async () => "Bad Gateway",
    });
    const { twilioSendVerification } = await import("./twilio-verify");
    await expect(twilioSendVerification("+966500000000")).rejects.toThrow(
      "twilio_send_failed:502",
    );
  });

  it("returns the parsed Twilio response on success (includes send_code_attempts when Debug mode is on)", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        sid: "VE123",
        to: "+966500000000",
        channel: "sms",
        status: "pending",
        valid: false,
        send_code_attempts: [
          { channel: "sms", attempt_sid: "VL1", time: "2026-08-04T00:00:00Z", code: "654321" },
        ],
      }),
    });
    const { twilioSendVerification } = await import("./twilio-verify");
    const result = await twilioSendVerification("+966500000000");
    expect(result.sid).toBe("VE123");
    expect(result.to).toBe("+966500000000");
    expect(result.send_code_attempts?.[0]?.code).toBe("654321");
  });

  it("returns an empty object when the success body is not JSON", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error("not json");
      },
    });
    const { twilioSendVerification } = await import("./twilio-verify");
    const result = await twilioSendVerification("+966500000000");
    expect(result).toEqual({});
  });
});

describe("twilioCheckVerification", () => {
  it("throws twilio_not_configured when no service sid", async () => {
    delete process.env.TWILIO_VERIFY_SERVICE_SID;
    const { twilioCheckVerification } = await import("./twilio-verify");
    await expect(
      twilioCheckVerification("+966500000000", "123456"),
    ).rejects.toThrow(/twilio_not_configured/);
  });

  it("returns true when status is approved", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ status: "approved" }),
    });
    const { twilioCheckVerification } = await import("./twilio-verify");
    expect(await twilioCheckVerification("+966500000000", "123 456")).toBe(
      true,
    );
    const [, opts] = mockFetch.mock.calls[0];
    expect(opts.body.get("Code")).toBe("123 456"); // preserves whitespace before trim
    expect(mockFetch.mock.calls[0][0]).toBe(
      "https://verify.twilio.com/v2/Services/VSverify/VerificationCheck",
    );
  });

  it("returns false when status is not approved", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ status: "pending" }),
    });
    const { twilioCheckVerification } = await import("./twilio-verify");
    expect(await twilioCheckVerification("+966500000000", "000000")).toBe(false);
  });

  it("returns false on a non-ok response (codes are public, no exception)", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({ message: "not found" }),
    });
    const { twilioCheckVerification } = await import("./twilio-verify");
    expect(await twilioCheckVerification("+966500000000", "000000")).toBe(false);
  });
});

describe("twilioVerifyHealthCheck", () => {
  it("returns ok:true with the service friendly_name on success", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ friendly_name: "My Service" }),
    });
    const { twilioVerifyHealthCheck } = await import("./twilio-verify");
    const out = await twilioVerifyHealthCheck();
    expect(out.ok).toBe(true);
    expect(out.verifyServiceName).toBe("My Service");
    expect(mockFetch.mock.calls[0][0]).toBe(
      "https://verify.twilio.com/v2/Services/VSverify",
    );
  });

  it("returns ok:false with http_<status> error when the body has no message", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 503,
      json: async () => ({ code: 999 }),
    });
    const { twilioVerifyHealthCheck } = await import("./twilio-verify");
    const out = await twilioVerifyHealthCheck();
    expect(out.ok).toBe(false);
    expect(out.error).toBe("http_503");
  });

  it("returns ok:false with error message on non-ok response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({ message: "Unauthorized" }),
    });
    const { twilioVerifyHealthCheck } = await import("./twilio-verify");
    const out = await twilioVerifyHealthCheck();
    expect(out.ok).toBe(false);
    expect(out.error).toBe("Unauthorized");
  });
});
