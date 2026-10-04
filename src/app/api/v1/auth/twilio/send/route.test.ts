/**
 * Regression test for the 60238 Twilio error code path on
 * /api/v1/auth/twilio/send.
 *
 * Background:
 *   The route catches Twilio Verify errors by inspecting the thrown
 *   error's `.message` (which is `twilio_send_failed:<code>`) and maps
 *   each known code to a 4xx/5xx response with an Arabic error message.
 *   Historically only 60200 was handled in the Geo Permissions arm.
 *
 *   In production we hit code 60238 ("Verification Creation Attempt
 *   blocked by Twilio") — Twilio returns 403 with this code when the
 *   recipient country is not enabled on the Verify Service's Geo
 *   Permissions allow-list. As of 2026-10-03, when Verify is blocked
 *   for the 60238/60200/21608 reasons we transparently fall back to a
 *   locally-generated OTP sent via Twilio Messaging Service — so the
 *   customer can still log in. These tests pin both behaviours:
 *     1. When the legacy fallback succeeds → 200 with `legacy: true`.
 *     2. When the legacy fallback is unavailable (no Messaging config)
 *        → 503 with the helpful Arabic message.
 *
 * Reference: https://www.twilio.com/docs/errors/60238
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

// Mock the verify lib so we control which Twilio error code is thrown.
vi.mock("@/lib/twilio-verify", () => ({
  isTwilioVerifyConfigured: () => true,
  twilioSendVerification: vi.fn(),
  twilioCheckVerification: vi.fn(),
}));

// Mock rate-limit so we don't hit the in-memory bucket during tests.
vi.mock("@/lib/rate-limit", async () => {
  const actual = await vi.importActual<typeof import("@/lib/rate-limit")>(
    "@/lib/rate-limit"
  );
  return {
    ...actual,
    checkRateLimit: () => ({
      allowed: true,
      remaining: 5,
      resetAt: Date.now() + 60_000,
      retryAfterMs: 0,
    }),
    createRateLimitHeaders: () => ({}),
  };
});

// Mock request-ip so it returns a stable value.
vi.mock("@/lib/request-ip", () => ({
  getClientIp: () => "127.0.0.1",
}));

// Silence the logger.
vi.mock("@/lib/logger", () => ({
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
}));

// Default mocks for the legacy fallback path. Individual tests can
// override via vi.mocked(...).mockReturnValueOnce(...) as needed.
vi.mock("@/lib/twilio-messaging", () => ({
  isTwilioMessagingConfigured: vi.fn(() => true),
  twilioSendSms: vi.fn(async () => ({ ok: true, sid: "SM-test-sid" })),
}));

vi.mock("@/lib/db", () => {
  const fakeClient = {
    query: vi.fn(async () => ({ rows: [{ id: "user-uuid-1" }] })),
    release: vi.fn(),
  };
  return { pool: { connect: vi.fn(async () => fakeClient) } };
});

vi.mock("@/lib/security/pii-crypto", () => ({
  encryptPii: (v: string) => `enc:${v}`,
  piiHmac: (v: string) => `hmac:${v}`,
}));

import { POST } from "./route";
import { twilioSendVerification as twilioSendVerificationMock } from "@/lib/twilio-verify";
import {
  isTwilioMessagingConfigured as isTwilioMessagingConfiguredMock,
  twilioSendSms as twilioSendSmsMock,
} from "@/lib/twilio-messaging";

// The mock factory exposes a vi.fn() but the type is the real function.
// Re-cast to Mock so .mockReset / .mockRejectedValueOnce are typed.
const twilioSendVerification = twilioSendVerificationMock as unknown as ReturnType<typeof vi.fn>;
const isTwilioMessagingConfigured = isTwilioMessagingConfiguredMock as unknown as ReturnType<typeof vi.fn>;
const twilioSendSms = twilioSendSmsMock as unknown as ReturnType<typeof vi.fn>;

function makeRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/v1/auth/twilio/send", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("POST /api/v1/auth/twilio/send — Twilio error mapping", () => {
  beforeEach(() => {
    twilioSendVerification.mockReset();
    twilioSendSms.mockReset();
    twilioSendSms.mockResolvedValue({ ok: true, sid: "SM-test-sid" } as never);
    isTwilioMessagingConfigured.mockReturnValue(true);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("maps Twilio 60238 (Geo Permissions block) → legacy OTP fallback when Messaging is configured", async () => {
    twilioSendVerification.mockRejectedValueOnce(
      new Error("twilio_send_failed:60238")
    );
    const res = await POST(makeRequest({ phone: "+966501234567" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.legacy).toBe(true);
    // Sanity: should NOT be the 502 fallback
    expect(body.error).toBeUndefined();
  });

  it("maps Twilio 60200 (Geo Permissions / invalid To) → legacy OTP fallback", async () => {
    twilioSendVerification.mockRejectedValueOnce(
      new Error("twilio_send_failed:60200")
    );
    const res = await POST(makeRequest({ phone: "+966501234567" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.legacy).toBe(true);
  });

  it("returns 503 with helpful Arabic message when Messaging is not configured and Verify is blocked", async () => {
    isTwilioMessagingConfigured.mockReturnValue(false);
    twilioSendVerification.mockRejectedValueOnce(
      new Error("twilio_send_failed:60238")
    );
    const res = await POST(makeRequest({ phone: "+966501234567" }));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toMatch(/غير مهيأة/);
  });

  it("falls back to 502 for unknown Twilio codes (existing behavior preserved)", async () => {
    twilioSendVerification.mockRejectedValueOnce(
      new Error("twilio_send_failed:99999")
    );
    const res = await POST(makeRequest({ phone: "+966501234567" }));
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toMatch(/حاول لاحقاً/);
  });

  it("maps Twilio 60410 (fraud block) to 403 (existing behavior preserved)", async () => {
    twilioSendVerification.mockRejectedValueOnce(
      new Error("twilio_send_failed:60410")
    );
    const res = await POST(makeRequest({ phone: "+966501234567" }));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.cause).toBe("twilio_60410_blocked");
  });
});
