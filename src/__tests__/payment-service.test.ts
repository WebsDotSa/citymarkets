import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Smoke tests for PaymentService — focused on the validation +
 * shape helpers. The DB-touching helpers (authorizeOrderForPayment)
 * have integration coverage via the per-route .test.ts files
 * (initiate/route.test.ts, retry/route.test.ts).
 *
 * The mocks below stub the customer-session lookup so the request
 * helpers (parsePaymentBody, validateOrderId) can run without
 * pulling in the whole HTTP middleware stack.
 */

vi.mock("@/lib/db", () => ({
  pool: { connect: vi.fn(), query: vi.fn() },
}));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn(async () => ({
    allowed: true,
    remaining: 100,
    resetAt: Date.now() + 60_000,
    retryAfterMs: 0,
  })),
  createRateLimitHeaders: vi.fn(() => ({})),
}));
vi.mock("@/lib/request-ip", () => ({
  getClientIp: vi.fn(() => "127.0.0.1"),
}));
vi.mock("@/lib/customer-session", () => ({
  resolveCustomerUserIdFromRequest: vi.fn(),
}));
vi.mock("@/lib/logger", () => ({
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
}));

import {
  ONLINE_RETRY_METHODS,
  MAX_IDEMPOTENCY_KEY,
  parsePaymentBody,
  rateLimitResponseHeaders,
  validateOrderId,
} from "@/lib/payments/payment-service";
import type { NextRequest } from "next/server";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("PaymentService — ONLINE_RETRY_METHODS", () => {
  it("includes the canonical card + wallet methods", () => {
    expect(ONLINE_RETRY_METHODS.has("mada")).toBe(true);
    expect(ONLINE_RETRY_METHODS.has("visa")).toBe(true);
    expect(ONLINE_RETRY_METHODS.has("mastercard")).toBe(true);
    expect(ONLINE_RETRY_METHODS.has("amex")).toBe(true);
    expect(ONLINE_RETRY_METHODS.has("apple_pay")).toBe(true);
  });

  it("excludes tamara (checkout-only) and bank_transfer (admin-only)", () => {
    expect(ONLINE_RETRY_METHODS.has("tamara")).toBe(false);
    expect(ONLINE_RETRY_METHODS.has("bank_transfer")).toBe(false);
    expect(ONLINE_RETRY_METHODS.has("stc_pay")).toBe(false);
    expect(ONLINE_RETRY_METHODS.has("cash")).toBe(false);
  });
});

describe("PaymentService — validateOrderId", () => {
  it("accepts a UUID-shaped string", () => {
    expect(validateOrderId("11111111-2222-3333-4444-555555555555")).toBe(
      "11111111-2222-3333-4444-555555555555",
    );
  });

  it("rejects non-UUID strings", () => {
    expect(validateOrderId("order-1")).toBeNull();
    expect(validateOrderId("not-a-uuid")).toBeNull();
    expect(validateOrderId("")).toBeNull();
    expect(validateOrderId(123)).toBeNull();
    expect(validateOrderId(null)).toBeNull();
    expect(validateOrderId(undefined)).toBeNull();
    expect(validateOrderId({})).toBeNull();
  });

  it("accepts uppercase UUIDs", () => {
    expect(validateOrderId("AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE")).toBe(
      "AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE",
    );
  });
});

describe("PaymentService — parsePaymentBody", () => {
  function makeRequest(body: unknown): NextRequest {
    return {
      json: async () => body,
    } as unknown as NextRequest;
  }

  it("returns the parsed object on valid JSON", async () => {
    const r = await parsePaymentBody(
      makeRequest({ orderId: "abc", idempotencyKey: "k1" }),
    );
    expect(r).toEqual({ orderId: "abc", idempotencyKey: "k1" });
  });

  it("returns null on parse failure", async () => {
    const r = await parsePaymentBody({
      json: async () => {
        throw new Error("bad json");
      },
    } as unknown as NextRequest);
    expect(r).toBeNull();
  });

  it("returns null on non-object body", async () => {
    const r = await parsePaymentBody(makeRequest("just a string"));
    expect(r).toBeNull();
  });

  it("returns null on null body", async () => {
    const r = await parsePaymentBody(makeRequest(null));
    expect(r).toBeNull();
  });
});

describe("PaymentService — rateLimitResponseHeaders", () => {
  it("adds the X-RateLimit-By header", () => {
    const headers = rateLimitResponseHeaders("user", {
      allowed: false,
      remaining: 0,
      resetAt: 0,
      retryAfterMs: 0,
    }) as Record<string, string>;
    expect(headers["X-RateLimit-By"]).toBe("user");
  });

  it("uses 'ip' for IP-based rate limits", () => {
    const headers = rateLimitResponseHeaders("ip", {
      allowed: false,
      remaining: 0,
      resetAt: 0,
      retryAfterMs: 0,
    }) as Record<string, string>;
    expect(headers["X-RateLimit-By"]).toBe("ip");
  });
});

describe("PaymentService — MAX_IDEMPOTENCY_KEY", () => {
  it("matches the documented contract", () => {
    expect(MAX_IDEMPOTENCY_KEY).toBe(64);
  });
});
