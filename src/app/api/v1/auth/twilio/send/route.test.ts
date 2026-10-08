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
 *   Permissions allow-list. Without this mapping, the request falls
 *   through to the generic 502 fallback.
 *
 * This test pins the 60238 → 400 mapping so future code edits don't
 * silently regress to the unhelpful 502 "تعذر إرسال رمز التحقق.
 * حاول لاحقاً" response.
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

import { POST } from "./route";
import { twilioSendVerification as twilioSendVerificationMock } from "@/lib/twilio-verify";

// The mock factory exposes a vi.fn() but the type is the real function.
// Re-cast to Mock so .mockReset / .mockRejectedValueOnce are typed.
const twilioSendVerification = twilioSendVerificationMock as unknown as ReturnType<typeof vi.fn>;

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
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("maps Twilio 60238 (Geo Permissions block) to 400 with helpful Arabic message", async () => {
    twilioSendVerification.mockRejectedValueOnce(
      new Error("twilio_send_failed:60238")
    );
    const res = await POST(makeRequest({ phone: "+966501234567" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/Geo Permissions/);
    // Sanity: should NOT be the generic 502 fallback
    expect(body.error).not.toMatch(/حاول لاحقاً/);
  });

  it("maps Twilio 60200 (Geo Permissions / invalid To) to 400 (existing behavior preserved)", async () => {
    twilioSendVerification.mockRejectedValueOnce(
      new Error("twilio_send_failed:60200")
    );
    const res = await POST(makeRequest({ phone: "+966501234567" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/Geo Permissions/);
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
