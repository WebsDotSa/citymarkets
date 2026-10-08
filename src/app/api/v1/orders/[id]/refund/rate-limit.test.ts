/**
 * Regression tests for PCP-114: refund endpoint rate limiting.
 *
 * Background: the customer refund endpoint at /api/v1/orders/[id]/refund
 * had no rate limiting — a logged-in user (or guest with the
 * idempotency_key secret) could repeatedly POST refund requests for the
 * same orderId, spamming refund_requests INSERTs (UNIQUE-per-order
 * blocks duplicates but logs still grow) and creating log-noise that
 * hides genuine refund-replay attacks.
 *
 * The fix adds REFUND_REQUEST_CONFIG + REFUND_REQUEST_IP_CONFIG to
 * src/lib/rate-limit.ts and applies them at the top of the handler.
 * These tests assert the 429 response shape and the bypass for the
 * rate-limit mock when called inside the normal request flow.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock rate-limit BEFORE importing the route
const { mockCheckRateLimit } = vi.hoisted(() => ({
  mockCheckRateLimit: vi.fn(),
}));

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: mockCheckRateLimit,
  createRateLimitHeaders: vi.fn(() => ({
    "X-RateLimit-Limit": "3",
    "X-RateLimit-Remaining": "0",
    "X-RateLimit-Reset": "9999999999",
  })),
  REFUND_REQUEST_CONFIG: { windowMs: 3600000, maxRequests: 3, keyPrefix: "refund:request" },
  REFUND_REQUEST_IP_CONFIG: { windowMs: 3600000, maxRequests: 10, keyPrefix: "refund:request:ip" },
}));

vi.mock("@/lib/csrf", () => ({
  applyCsrfProtection: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/identity", () => ({
  resolveCustomerUserIdFromRequest: vi.fn().mockResolvedValue("user-1"),
}));

vi.mock("@/lib/db", () => {
  const mockClient = {
    query: vi.fn(),
    release: vi.fn(),
  };
  return {
    pool: {
      connect: vi.fn().mockResolvedValue(mockClient),
      query: vi.fn(),
    },
  };
});

vi.mock("@/lib/logger", () => ({
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
}));

import { POST } from "./route";

describe("POST /api/v1/orders/[id]/refund — PCP-114 rate limiting", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: rate limit allows the request
    mockCheckRateLimit.mockResolvedValue({ allowed: true, remaining: 2, resetAt: 0 });
  });

  it("returns 429 when IP rate limit is exceeded", async () => {
    mockCheckRateLimit.mockResolvedValueOnce({
      allowed: false,
      remaining: 0,
      resetAt: 9999999999,
    });

    const request = new Request("http://localhost/api/v1/orders/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/refund", {
      method: "POST",
      headers: {
        "x-forwarded-for": "1.2.3.4",
        "content-type": "application/json",
      },
      body: JSON.stringify({}),
    });
    const res = await POST(request as never, {
      params: Promise.resolve({ id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" }),
    });

    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error).toMatch(/تجاوز/);
    expect(res.headers.get("X-RateLimit-Limit")).toBe("3");
  });

  it("returns 429 when per-user rate limit is exceeded", async () => {
    // First call (IP) passes; second call (per-user) blocks
    mockCheckRateLimit
      .mockResolvedValueOnce({ allowed: true, remaining: 9, resetAt: 0 })
      .mockResolvedValueOnce({ allowed: false, remaining: 0, resetAt: 9999999999 });

    const request = new Request("http://localhost/api/v1/orders/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/refund", {
      method: "POST",
      headers: {
        "x-forwarded-for": "9.9.9.9",
        "content-type": "application/json",
      },
      body: JSON.stringify({}),
    });
    const res = await POST(request as never, {
      params: Promise.resolve({ id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" }),
    });

    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error).toMatch(/تجاوز/);
  });
});