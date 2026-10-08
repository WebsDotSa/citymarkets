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
vi.mock('@/lib/identity', () => ({
  resolveCustomerUserIdFromRequest: vi.fn(),
}));
vi.mock("@/lib/logger", () => ({
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
}));

import {
  MAX_IDEMPOTENCY_KEY,
  parsePaymentBody,
  rateLimitResponseHeaders,
  validateOrderId,
} from "@/lib/payments/payment-service";
import { ONLINE_RETRY_METHODS_SET } from "@/lib/payments/payment-methods";
import type { NextRequest } from "next/server";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("PaymentService — ONLINE_RETRY_METHODS_SET", () => {
  it("includes the canonical card + wallet methods", () => {
    expect(ONLINE_RETRY_METHODS_SET.has("mada")).toBe(true);
    expect(ONLINE_RETRY_METHODS_SET.has("visa")).toBe(true);
    expect(ONLINE_RETRY_METHODS_SET.has("mastercard")).toBe(true);
    expect(ONLINE_RETRY_METHODS_SET.has("amex")).toBe(true);
    expect(ONLINE_RETRY_METHODS_SET.has("apple_pay")).toBe(true);
  });

  it("excludes tamara (checkout-only) and bank_transfer (admin-only)", () => {
    expect(ONLINE_RETRY_METHODS_SET.has("tamara")).toBe(false);
    expect(ONLINE_RETRY_METHODS_SET.has("bank_transfer")).toBe(false);
    expect(ONLINE_RETRY_METHODS_SET.has("stc_pay")).toBe(false);
    expect(ONLINE_RETRY_METHODS_SET.has("cash")).toBe(false);
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

/**
 * SECURITY REGRESSION (HIGH): `authorizeOrderForPayment` used to ROLLBACK
 * and return without `client.release()` on every non-ok branch
 * (not_found / forbidden / ineligible / invalid_total). With pool
 * max=20, repeated rejected requests from one IP could check out every
 * connection permanently and freeze the payments endpoints.
 *
 * The contract on the happy path is unchanged: when the row is found,
 * authorized, and the total is finite, the function hands ownership of
 * the live `client` to the caller (via commitOrderLock /
 * rollbackOrderLock). Every other branch must release the client itself
 * so the pool never leaks.
 */
describe("PaymentService — authorizeOrderForPayment pool-client hygiene", () => {
  function makeMockClient() {
    return {
      query: vi.fn(async (sql: string) => {
        if (sql === "BEGIN") return { rows: [] };
        if (sql === "ROLLBACK") return { rows: [] };
        throw new Error("unexpected query in this test");
      }),
      release: vi.fn(),
    };
  }

  async function runWithMocks(args: {
    row: Record<string, unknown> | null;
    skipActionCheck?: boolean;
    userId?: string;
  }) {
    const { pool } = await import("@/lib/db");
    const client = makeMockClient();
    (pool.connect as ReturnType<typeof vi.fn>).mockResolvedValueOnce(client);

    // First SELECT returns the configured row (or [] when row is null);
    // every later SELECT is irrelevant for these tests.
    let firstSelect = true;
    client.query.mockImplementation(async (sql: string) => {
      if (sql === "BEGIN" || sql === "ROLLBACK" || sql === "COMMIT") {
        return { rows: [] };
      }
      if (firstSelect) {
        firstSelect = false;
        if (args.row === null) {
          return { rows: [] };
        }
        return {
          rows: [
            {
              user_id: args.row.user_id ?? null,
              total: args.row.total ?? "10.00",
              payment_status: args.row.payment_status ?? "pending",
              status: args.row.status ?? "pending",
              payment_method: args.row.payment_method ?? "moyasar",
              guest_phone: args.row.guest_phone ?? null,
              guest_name: args.row.guest_name ?? null,
            },
          ],
        };
      }
      return { rows: [] };
    });

    const { authorizeOrderForPayment } = await import(
      "@/lib/payments/payment-service"
    );
    return authorizeOrderForPayment({
      orderId: "00000000-0000-0000-0000-000000000001",
      userId: args.userId ?? "user-1",
      skipActionCheck: args.skipActionCheck,
    }).then((res) => ({ res, client }));
  }

  it("releases the client on not_found (no matching order)", async () => {
    const { res, client } = await runWithMocks({ row: null });
    expect(res.kind).toBe("not_found");
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it("releases the client on forbidden (registered order, mismatched userId)", async () => {
    const { res, client } = await runWithMocks({
      row: { user_id: "user-other" },
      userId: "user-1",
    });
    expect(res.kind).toBe("forbidden");
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it("releases the client on invalid_total (non-numeric total)", async () => {
    const { res, client } = await runWithMocks({
      // skipActionCheck lets us reach invalid_total before the action
      // check; the default `pending` + `moyasar` combination returns
      // "none" from getOrderPaymentAction, which would otherwise
      // short-circuit this branch with `ineligible`.
      row: { user_id: "user-1", total: "not-a-number" },
      skipActionCheck: true,
    });
    expect(res.kind).toBe("invalid_total");
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it("does NOT release the client on the ok branch (caller owns it)", async () => {
    const { res, client } = await runWithMocks({
      row: { user_id: "user-1", total: "12.34" },
      skipActionCheck: true,
    });
    expect(res.kind).toBe("ok");
    // On the happy path the caller is expected to call
    // commitOrderLock / rollbackOrderLock. The leak in the past was
    // every OTHER branch NOT releasing.
    expect(client.release).not.toHaveBeenCalled();
  });

  it("releases the client on ineligible (action === 'none')", async () => {
    const { res, client } = await runWithMocks({
      // status='delivered' + payment_status='paid' makes
      // getOrderPaymentAction return 'none' (already final).
      row: {
        user_id: "user-1",
        total: "10.00",
        status: "delivered",
        payment_status: "paid",
        payment_method: "moyasar",
      },
    });
    expect(res.kind).toBe("ineligible");
    expect(client.release).toHaveBeenCalledTimes(1);
  });
});
