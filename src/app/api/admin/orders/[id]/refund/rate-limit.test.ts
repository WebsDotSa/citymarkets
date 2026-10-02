/**
 * Regression tests for PCP-114: admin refund endpoint rate limiting.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

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

const { mockRequireAdminApi } = vi.hoisted(() => ({
  mockRequireAdminApi: vi.fn(),
}));

vi.mock("@/lib/identity/admin-api-auth-db", () => ({
  requireAdminApi: mockRequireAdminApi,
}));

vi.mock("@/lib/db", () => {
  const mockClient = {
    query: vi.fn(),
    release: vi.fn(),
  };
  return {
    pool: {
      query: vi.fn(),
      connect: vi.fn().mockResolvedValue(mockClient),
    },
  };
});

vi.mock("@/lib/logger", () => ({
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
}));

import { POST } from "./route";

describe("POST /api/admin/orders/[id]/refund — PCP-114 rate limiting", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckRateLimit.mockResolvedValue({ allowed: true, remaining: 99, resetAt: 0 });
    mockRequireAdminApi.mockResolvedValue({
      admin: { id: "admin-1", email: "admin@citymarkets.sa" },
      userId: "admin-1",
      isSuperAdmin: true,
    });
  });

  it("returns 429 when admin IP rate limit is exceeded", async () => {
    mockCheckRateLimit.mockResolvedValueOnce({
      allowed: false,
      remaining: 0,
      resetAt: 9999999999,
    });

    const request = new Request("http://localhost/api/admin/orders/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/refund", {
      method: "POST",
      headers: {
        "x-forwarded-for": "1.2.3.4",
        "content-type": "application/json",
        "x-csrf-token": "valid",
        cookie: "csrf_token=valid",
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

  it("returns 429 when per-admin-user rate limit is exceeded", async () => {
    mockCheckRateLimit
      .mockResolvedValueOnce({ allowed: true, remaining: 9, resetAt: 0 })
      .mockResolvedValueOnce({ allowed: false, remaining: 0, resetAt: 9999999999 });

    const request = new Request("http://localhost/api/admin/orders/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/refund", {
      method: "POST",
      headers: {
        "x-forwarded-for": "9.9.9.9",
        "content-type": "application/json",
        "x-csrf-token": "valid",
        cookie: "csrf_token=valid",
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

  it("keys the per-admin-user limit by 'admin:<userId>'", async () => {
    // We only assert the rate-limit was called with the right key prefix,
    // not the full handler execution. Use a mock that simulates the rate
    // limit throwing to bail out before the DB layer is touched.
    mockCheckRateLimit
      .mockResolvedValueOnce({ allowed: true, remaining: 9, resetAt: 0 }) // IP
      .mockImplementationOnce(() => {
        throw new Error("rate_limit_aborted_handler");
      });

    const request = new Request("http://localhost/api/admin/orders/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/refund", {
      method: "POST",
      headers: {
        "x-forwarded-for": "9.9.9.9",
        "content-type": "application/json",
        "x-csrf-token": "valid",
        cookie: "csrf_token=valid",
      },
      body: JSON.stringify({}),
    });
    await POST(request as never, {
      params: Promise.resolve({ id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" }),
    }).catch(() => undefined);

    const userCalls = mockCheckRateLimit.mock.calls.filter(([_key, config]) =>
      (config as { keyPrefix?: string }).keyPrefix === "refund:request",
    );
    expect(userCalls.length).toBeGreaterThanOrEqual(1);
    expect(userCalls[0][0]).toMatch(/^admin:admin-1$/);
  });
});