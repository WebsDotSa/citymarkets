import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const ORIGINAL = { ...process.env };

describe("email (Resend)", () => {
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

  it("isEmailConfigured returns false when env missing", async () => {
    delete process.env.RESEND_API_KEY;
    delete process.env.RESEND_FROM;
    const { isEmailConfigured } = await import("./email");
    expect(isEmailConfigured()).toBe(false);
  });

  it("isEmailConfigured returns true when env set", async () => {
    process.env.RESEND_API_KEY = "re_test";
    process.env.RESEND_FROM = "noreply@citymarkets.sa";
    const { isEmailConfigured } = await import("./email");
    expect(isEmailConfigured()).toBe(true);
  });

  it("sendEmail returns email_not_configured when env missing", async () => {
    delete process.env.RESEND_API_KEY;
    delete process.env.RESEND_FROM;
    const { sendEmail } = await import("./email");
    const out = await sendEmail({
      to: "a@b.c",
      subject: "x",
      html: "<p>x</p>",
    });
    expect(out).toEqual({ ok: false, error: "email_not_configured" });
  });

  it("sendEmail posts to Resend and returns id on success", async () => {
    process.env.RESEND_API_KEY = "re_test";
    process.env.RESEND_FROM = "noreply@citymarkets.sa";
    process.env.RESEND_REPLY_TO = "support@citymarkets.sa";
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: "msg_123" }),
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const { sendEmail } = await import("./email");
    const out = await sendEmail({
      to: "a@b.c",
      subject: "Hi",
      html: "<p>x</p>",
    });
    expect(out).toEqual({ ok: true, id: "msg_123" });
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    const body = JSON.parse(opts.body as string);
    expect(body.from).toBe("noreply@citymarkets.sa");
    expect(body.reply_to).toBe("support@citymarkets.sa");
  });

  it("sendEmail returns error message when Resend responds non-ok", async () => {
    process.env.RESEND_API_KEY = "re_test";
    process.env.RESEND_FROM = "noreply@citymarkets.sa";
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => ({ message: "Invalid to" }),
    }) as unknown as typeof fetch;
    const { sendEmail } = await import("./email");
    const out = await sendEmail({ to: "bad", subject: "x", html: "<p/>" });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toBe("Invalid to");
  });

  it("sendEmail returns network_error on thrown fetch", async () => {
    process.env.RESEND_API_KEY = "re_test";
    process.env.RESEND_FROM = "noreply@citymarkets.sa";
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("boom")) as unknown as typeof fetch;
    const { sendEmail } = await import("./email");
    const out = await sendEmail({ to: "a@b.c", subject: "x", html: "<p/>" });
    expect(out).toEqual({ ok: false, error: "network_error" });
  });
});