import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  checkRateLimit,
  checkRateLimitSync,
  closeRateLimiter,
  GENERAL_API_CONFIG,
  CART_OPERATION_CONFIG,
  ORDER_CREATE_CONFIG,
  ADMIN_LOGIN_CONFIG,
  ADMIN_LOGIN_IP_CONFIG,
  OTP_SEND_CONFIG,
  OTP_SEND_IP_CONFIG,
  OTP_VERIFY_CONFIG,
  OTP_VERIFY_IP_CONFIG,
  PAYMENT_INITIATE_CONFIG,
  PAYMENT_INITIATE_IP_CONFIG,
  createRateLimitHeaders,
} from './rate-limit';

/**
 * Rate limiting tests
 */
describe('Rate Limiting', () => {
  // Mock in-memory store for testing
  const store = new Map<string, { count: number; resetAt: number }>();

  function checkRateLimit(
    key: string,
    limit: number,
    windowMs: number
  ): { allowed: boolean; remaining: number; resetAt: number } {
    const now = Date.now();
    const record = store.get(key);

    // Reset if window expired
    if (!record || record.resetAt <= now) {
      store.set(key, { count: 1, resetAt: now + windowMs });
      return { allowed: true, remaining: limit - 1, resetAt: now + windowMs };
    }

    // Increment count
    if (record.count >= limit) {
      return { allowed: false, remaining: 0, resetAt: record.resetAt };
    }

    record.count++;
    return { allowed: true, remaining: limit - record.count, resetAt: record.resetAt };
  }

  beforeEach(() => {
    store.clear();
  });

  it('should allow first request', () => {
    const result = checkRateLimit('test-key', 5, 60000);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(4);
  });

  it('should track request count', () => {
    checkRateLimit('test-key', 5, 60000);
    checkRateLimit('test-key', 5, 60000);
    const result = checkRateLimit('test-key', 5, 60000);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(2);
  });

  it('should block when limit exceeded', () => {
    for (let i = 0; i < 5; i++) {
      checkRateLimit('test-key', 5, 60000);
    }
    const result = checkRateLimit('test-key', 5, 60000);
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it('should track different keys independently', () => {
    checkRateLimit('key1', 5, 60000);
    checkRateLimit('key1', 5, 60000);
    checkRateLimit('key2', 5, 60000);

    const result1 = checkRateLimit('key1', 5, 60000);
    const result2 = checkRateLimit('key2', 5, 60000);

    expect(result1.remaining).toBe(2);
    expect(result2.remaining).toBe(3);
  });

  it('should return reset time', () => {
    const before = Date.now();
    const result = checkRateLimit('test-key', 5, 60000);
    expect(result.resetAt).toBeGreaterThanOrEqual(before);
    expect(result.resetAt).toBeLessThanOrEqual(before + 60000);
  });
});

// ---------------------------------------------------------------------------
// Regression tests for the production rate limiter used by the API.
// Each test uses a fresh identifier to avoid bleeding state between tests.
// ---------------------------------------------------------------------------

function uniqueId(prefix: string): string {
  return `${prefix}:${Math.random().toString(36).slice(2, 12)}`;
}

describe("production rate limiter (in-memory fallback)", () => {
  it("allows up to maxRequests inside the window", async () => {
    const id = uniqueId("prod");
    const cfg = { ...GENERAL_API_CONFIG, maxRequests: 3, windowMs: 60_000 };
    const a = await checkRateLimit(id, cfg);
    const b = await checkRateLimit(id, cfg);
    const c = await checkRateLimit(id, cfg);
    expect(a.allowed && b.allowed && c.allowed).toBe(true);
    expect(c.remaining).toBe(0);
  });

  it("rejects after the limit is hit and emits retry-after", async () => {
    const id = uniqueId("prod");
    const cfg = { ...GENERAL_API_CONFIG, maxRequests: 2, windowMs: 60_000 };
    await checkRateLimit(id, cfg);
    await checkRateLimit(id, cfg);
    const blocked = await checkRateLimit(id, cfg);
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
  });

  it("isolates counters per identifier", async () => {
    const a = uniqueId("prod");
    const b = uniqueId("prod");
    const cfg = { ...GENERAL_API_CONFIG, maxRequests: 1, windowMs: 60_000 };
    expect((await checkRateLimit(a, cfg)).allowed).toBe(true);
    expect((await checkRateLimit(b, cfg)).allowed).toBe(true);
  });
});

describe("checkRateLimitSync", () => {
  it("rejects when over the limit (sync path used by hooks)", () => {
    const id = uniqueId("sync");
    const cfg = { ...CART_OPERATION_CONFIG, maxRequests: 1, windowMs: 60_000 };
    expect(checkRateLimitSync(id, cfg).allowed).toBe(true);
    const second = checkRateLimitSync(id, cfg);
    expect(second.allowed).toBe(false);
  });
});

describe("rate-limit presets (cost-amplification defense)", () => {
  it("OTP_SEND_CONFIG caps at 3 per 10 minutes", () => {
    expect(OTP_SEND_CONFIG.maxRequests).toBe(3);
    expect(OTP_SEND_CONFIG.windowMs).toBe(10 * 60 * 1000);
  });

  it("OTP_SEND_IP_CONFIG uses an independent, broader IP bucket", () => {
    expect(OTP_SEND_IP_CONFIG.keyPrefix).not.toBe(OTP_SEND_CONFIG.keyPrefix);
    expect(OTP_SEND_IP_CONFIG.maxRequests).toBeGreaterThan(OTP_SEND_CONFIG.maxRequests);
    expect(OTP_SEND_IP_CONFIG.windowMs).toBe(OTP_SEND_CONFIG.windowMs);
  });

  it("OTP_VERIFY_IP_CONFIG uses an independent, broader IP bucket", () => {
    expect(OTP_VERIFY_IP_CONFIG.keyPrefix).not.toBe(OTP_VERIFY_CONFIG.keyPrefix);
    expect(OTP_VERIFY_IP_CONFIG.maxRequests).toBeGreaterThan(OTP_VERIFY_CONFIG.maxRequests);
    expect(OTP_VERIFY_IP_CONFIG.windowMs).toBe(OTP_VERIFY_CONFIG.windowMs);
  });

  it("payment initiation has independent user and IP buckets", () => {
    expect(PAYMENT_INITIATE_CONFIG.maxRequests).toBeGreaterThan(0);
    expect(PAYMENT_INITIATE_CONFIG.windowMs).toBeGreaterThanOrEqual(60_000);
    expect(PAYMENT_INITIATE_IP_CONFIG.keyPrefix).not.toBe(
      PAYMENT_INITIATE_CONFIG.keyPrefix
    );
    expect(PAYMENT_INITIATE_IP_CONFIG.maxRequests).toBeGreaterThanOrEqual(
      PAYMENT_INITIATE_CONFIG.maxRequests
    );
  });

  it("ORDER_CREATE_CONFIG caps at 15 per 10 minutes", () => {
    expect(ORDER_CREATE_CONFIG.maxRequests).toBe(15);
    expect(ORDER_CREATE_CONFIG.windowMs).toBe(10 * 60 * 1000);
  });

  it("CART_OPERATION_CONFIG caps at 50 per 10 minutes", () => {
    expect(CART_OPERATION_CONFIG.maxRequests).toBe(50);
    expect(CART_OPERATION_CONFIG.windowMs).toBe(10 * 60 * 1000);
  });

  it("ADMIN_LOGIN_CONFIG caps at 5 per 15 minutes", () => {
    expect(ADMIN_LOGIN_CONFIG.maxRequests).toBe(5);
    expect(ADMIN_LOGIN_CONFIG.windowMs).toBe(15 * 60 * 1000);
  });

  it("ADMIN_LOGIN_IP_CONFIG caps at 10 per 15 minutes", () => {
    expect(ADMIN_LOGIN_IP_CONFIG.maxRequests).toBe(10);
    expect(ADMIN_LOGIN_IP_CONFIG.windowMs).toBe(15 * 60 * 1000);
    expect(ADMIN_LOGIN_IP_CONFIG.keyPrefix).not.toBe(ADMIN_LOGIN_CONFIG.keyPrefix);
  });

});

describe("closeRateLimiter", () => {
  it("does not throw when no Redis client is configured (in-memory mode)", async () => {
    await expect(closeRateLimiter()).resolves.toBeUndefined();
  });
});

describe("createRateLimitHeaders edge cases", () => {
  it("omits Retry-After when not blocked", () => {
    const h = createRateLimitHeaders({
      allowed: true,
      remaining: 10,
      resetAt: 1,
    });
    expect(h["Retry-After"]).toBeUndefined();
  });

  it("omits Retry-After when blocked but retryAfterMs is missing", () => {
    const h = createRateLimitHeaders({
      allowed: false,
      remaining: 0,
      resetAt: 1,
    });
    expect(h["Retry-After"]).toBeUndefined();
  });
});

describe("checkRateLimit (in-memory after window expires)", () => {
  it("creates a fresh entry when resetAt is in the past", async () => {
    vi.useFakeTimers();
    try {
      const id = uniqueId("reset");
      const cfg = { ...GENERAL_API_CONFIG, maxRequests: 1, windowMs: 1_000 };
      const first = await checkRateLimit(id, cfg);
      expect(first.allowed).toBe(true);
      // Advance past the window — the entry's resetAt is now in the past
      vi.advanceTimersByTime(2_000);
      const second = await checkRateLimit(id, cfg);
      expect(second.allowed).toBe(true);
      expect(second.remaining).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("createRateLimitHeaders", () => {
  it("emits X-RateLimit-Remaining and X-RateLimit-Reset on success", () => {
    const h = createRateLimitHeaders({
      allowed: true,
      remaining: 7,
      resetAt: 1234567890,
    });
    expect(h["X-RateLimit-Remaining"]).toBe("7");
    expect(h["X-RateLimit-Reset"]).toBe("1234567890");
    expect(h["Retry-After"]).toBeUndefined();
  });

  it("emits Retry-After when blocked", () => {
    const h = createRateLimitHeaders({
      allowed: false,
      remaining: 0,
      resetAt: Date.now() + 30_000,
      retryAfterMs: 30_000,
    });
    expect(h["Retry-After"]).toBe("30");
  });
});

describe("rateLimitExceededResponse (shared 429 for auth/OTP routes)", () => {
  it("keeps the legacy body and headers", async () => {
    const { rateLimitExceededResponse } = await import("./rate-limit");
    const res = rateLimitExceededResponse(
      { allowed: false, remaining: 0, resetAt: 123, retryAfterMs: 1500 } as never,
      "slow down",
      "ip",
    );
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "slow down", retryAfter: 2 });
    expect(res.headers.get("X-RateLimit-By")).toBe("ip");
    expect(res.headers.get("Retry-After")).toBe("2");
  });
});
