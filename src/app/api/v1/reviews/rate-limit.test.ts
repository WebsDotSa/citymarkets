/**
 * Tests for POST/DELETE /api/v1/reviews rate limiting.
 *
 * PCP-125: REVIEW_SUBMIT_IP_CONFIG was defined in src/lib/rate-limit.ts
 * (5/min/IP) but never wired into the route. The Phase 10 audit found
 * reviews could be flooded from a single IP.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/identity", () => ({
  resolveCustomerUserIdFromRequest: vi.fn(async () => "11111111-1111-1111-1111-111111111111"),
}));

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn(async () => ({
    allowed: true,
    remaining: 999,
    resetAt: new Date(Date.now() + 60_000),
  })),
  REVIEW_SUBMIT_IP_CONFIG: { windowMs: 60_000, maxRequests: 5, keyPrefix: "reviews:submit:ip" },
}));

vi.mock("@/lib/request-ip", () => ({
  getClientIp: vi.fn(() => "127.0.0.1"),
}));

vi.mock("@/lib/db", () => ({
  pool: {
    connect: vi.fn(async () => ({
      query: vi.fn(async () => ({ rows: [] })),
      release: vi.fn(),
    })),
  },
}));

import { POST } from "./route";

function makeRequest(body: unknown) {
  return new Request("http://localhost:3005/api/v1/reviews", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/v1/reviews — rate limit (PCP-125)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 429 after 5 review POSTs from same IP within a minute", async () => {
    const { checkRateLimit } = await import("@/lib/rate-limit");
    let calls = 0;
    vi.mocked(checkRateLimit).mockImplementation((async (...args: unknown[]) => {
      const cfg = args[1] as { keyPrefix?: string };
      if (cfg.keyPrefix === "reviews:submit:ip") {
        calls += 1;
        return calls > 5
          ? { allowed: false, remaining: 0, resetAt: new Date(Date.now() + 60_000) }
          : { allowed: true, remaining: 5 - calls, resetAt: new Date(Date.now() + 60_000) };
      }
      return { allowed: true, remaining: 999, resetAt: new Date(Date.now() + 60_000) };
    }) as never);

    const req = makeRequest({
      productId: "11111111-1111-1111-1111-111111111111",
      rating: 5,
      comment: "great product",
    });

    // 5 allowed (one of which will then try the DB and likely 500 because
    // the mock connect returns 0 rows for INSERT path — that's fine, we
    // only care that the rate-limit gate runs BEFORE the DB call).
    for (let i = 0; i < 5; i += 1) {
      const res = await POST(req as never);
      // The first 5 may 500 (no real DB) but they MUST NOT 429.
      expect(res.status).not.toBe(429);
    }

    // 6th request → 429
    const res6 = await POST(req as never);
    expect(res6.status).toBe(429);
  });
});