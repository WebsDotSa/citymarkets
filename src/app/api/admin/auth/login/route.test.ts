import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * SECURITY regression for the unauthenticated "send admin OTP" step
 * (phone without code): it must be rate-limited and must only text
 * numbers that belong to an active staff account, while returning the
 * same response either way.
 */

let staffExists = true;
let limitAllowed: Record<string, boolean> = {};
const rateKeys: string[] = [];

vi.mock("@/lib/db", () => ({
  query: vi.fn(async (sql: string) => {
    if (/FROM admin_users/.test(sql)) return { rows: staffExists ? [{ "?column?": 1 }] : [] };
    return { rows: [] };
  }),
}));

vi.mock("@/lib/identity", () => ({
  signAdminSessionToken: vi.fn(),
  ADMIN_SESSION_COOKIE: "admin_session",
  adminSessionCookieOptions: vi.fn(() => ({})),
}));

vi.mock("@/lib/request-ip", () => ({ getClientIp: () => "203.0.113.7" }));

vi.mock("@/lib/rate-limit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rate-limit")>();
  return {
    ...actual,
    checkRateLimit: vi.fn(async (key: string, cfg: { keyPrefix: string }) => {
      rateKeys.push(`${cfg.keyPrefix}|${key}`);
      const allowed = limitAllowed[cfg.keyPrefix] ?? true;
      return { allowed, remaining: allowed ? 1 : 0, resetAt: Date.now() + 1000 };
    }),
  };
});

const sendMock = vi.fn(async () => undefined);
vi.mock("@/lib/twilio-verify", () => ({
  isTwilioVerifyConfigured: () => true,
  twilioCheckVerification: vi.fn(),
  twilioSendVerification: (...a: unknown[]) => sendMock(...(a as [])),
}));

import { POST } from "./route";

const sendReq = () =>
  ({
    headers: { get: () => null },
    cookies: { get: () => undefined },
    url: "http://x/api/admin/auth/login",
    json: async () => ({ mode: "otp", phone: "0551112222" }),
  }) as never;

describe("admin login — OTP send step", () => {
  beforeEach(() => {
    staffExists = true;
    limitAllowed = {};
    rateKeys.length = 0;
    sendMock.mockClear();
  });

  it("sends the code to an active staff number, rate-limited per IP and phone", async () => {
    const res = await POST(sendReq());
    expect(res.status).toBe(200);
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(rateKeys.some((k) => k.startsWith("otp:send:ip|"))).toBe(true);
    expect(rateKeys.some((k) => k.startsWith("otp:send|admin:+966"))).toBe(true);
  });

  it("does not text non-staff numbers but returns the same response", async () => {
    staffExists = false;
    const res = await POST(sendReq());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.step).toBe("otp_sent");
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("returns 429 and sends nothing when the IP cap is hit", async () => {
    limitAllowed["otp:send:ip"] = false;
    const res = await POST(sendReq());
    expect(res.status).toBe(429);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("returns 429 and sends nothing when the per-phone cap is hit", async () => {
    limitAllowed["otp:send"] = false;
    const res = await POST(sendReq());
    expect(res.status).toBe(429);
    expect(sendMock).not.toHaveBeenCalled();
  });
});
