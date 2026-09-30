import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Regression test for GET /api/v1/orders/track.
 *
 * The public order-tracking endpoint joins `order_items` to the
 * products catalog to enrich each line with `name_ar` and
 * `image_url`. The migration replaced bare `products` with the
 * `products_unified` view (see migration 039 + 040b).
 *
 * This test guarantees the items query targets `products_unified`
 * via a LEFT JOIN and never falls back to bare `products`.
 *
 * The route uses `pool.connect`, so we mock the client returned by
 * `pool.connect` and capture every `client.query(sql, params)` call.
 */

type QueryCall = { sql: string; params: unknown[] };

function makeFakeClient() {
  const calls: QueryCall[] = [];
  const client = {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      const s = sql.trim().toUpperCase();

      // 1. Orders lookup — return a single row so the route proceeds
      //    to fetch items.
      if (s.startsWith("SELECT") && s.includes("FROM ORDERS")) {
        return {
          rows: [
            {
              id: "order-1",
              status: "pending",
              type: "delivery",
              total: "42.00",
              payment_method: "cash",
              guest_name: "ضيف",
              guest_phone: "0501234567",
              guest_city: "الرياض",
              guest_district: "العليا",
              tracking_code: "123456",
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            },
          ],
        };
      }

      // 2. Items query — must JOIN products_unified (migration target).
      if (s.includes("FROM ORDER_ITEMS") && s.includes("PRODUCTS_UNIFIED")) {
        return { rows: [] };
      }

      return { rows: [] };
    }),
    release: vi.fn(),
  };
  return { client, calls };
}

vi.mock("@/lib/db", () => ({
  pool: { connect: vi.fn() },
  query: vi.fn(),
}));

vi.mock("@/lib/logger", () => ({
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
}));

vi.mock("@/lib/request-ip", () => ({
  getClientIp: () => "127.0.0.1",
}));

// P1-8 (full-system audit 2026-09-30): the per-(ip, code) lockout
// uses the real in-memory rate limiter so the failure-count is shared
// across the tests below — we reset it between cases via vi.clearAllMocks
// + the store reset helper exported for tests.
import { pool } from "@/lib/db";
import { __resetRateLimitStoreForTests } from "@/lib/rate-limit";
import { GET } from "./route";

function mockRequest(url: string): Request {
  return { headers: { get: () => null }, url } as unknown as Request;
}

/**
 * Build a fake pg client that returns `rows` from `ordersRow` for the
 * lookup, and empty rows for everything else (including the items query).
 */
function makeOrderClient(ordersRow: unknown | null) {
  const calls: QueryCall[] = [];
  const client = {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      const s = sql.trim().toUpperCase();
      if (s.startsWith("SELECT") && s.includes("FROM ORDERS")) {
        return { rows: ordersRow ? [ordersRow] : [] };
      }
      return { rows: [] };
    }),
    release: vi.fn(),
  };
  return { client, calls };
}

describe("GET /api/v1/orders/track — products_unified migration (regression)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("joins order_items to products_unified (not bare products)", async () => {
    const { client, calls } = makeFakeClient();
    vi.mocked(pool.connect).mockResolvedValueOnce(client as never);

    // PHONE_RE-compliant phone + 6-digit tracking code (PHONE_RE
    // is /^[+\d][\d\s\-()]{5,20}$/ and code is /^\d{6}$/).
    const url =
      "http://localhost/api/v1/orders/track?phone=%2B966501234567&code=123456";
    const res = await GET(mockRequest(url) as never);

    expect(res.status).toBe(200);

    // Migration target: at least one call must JOIN products_unified.
    const usesUnified = calls.some((c) =>
      /\bFROM\s+products_unified\b/i.test(c.sql) ||
      /\bJOIN\s+products_unified\b/i.test(c.sql)
    );
    expect(usesUnified).toBe(true);

    // Negative guarantee: no SQL string references bare
    // `products` (without `_unified` suffix).
    const usesBareProducts = calls.some((c) =>
      /\bFROM\s+products\b(?!_unified)/i.test(c.sql) ||
      /\bJOIN\s+products\b(?!_unified)/i.test(c.sql)
    );
    expect(usesBareProducts).toBe(false);
  });
});

describe("GET /api/v1/orders/track — per-(ip, code) lockout (P1-8)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // The in-memory rate-limit store is module-level; reset between
    // tests via the public helper exported from @/lib/rate-limit.
    __resetRateLimitStoreForTests();
  });

  const failUrl =
    "http://localhost/api/v1/orders/track?phone=%2B966500000000&code=999999";

  it("returns 404 with no lockout on first miss", async () => {
    const { client } = makeOrderClient(null);
    vi.mocked(pool.connect).mockResolvedValueOnce(client as never);

    const res = await GET(mockRequest(failUrl) as never);
    expect(res.status).toBe(404);
  });

  it("locks the (ip, code) pair after 5 consecutive misses with 429", async () => {
    // The per-code lockout is keyed on (ip, code). Same IP + same code
    // 5 times → 6th request returns 429 with the Arabic message.
    for (let i = 0; i < 5; i++) {
      const { client } = makeOrderClient(null);
      vi.mocked(pool.connect).mockResolvedValueOnce(client as never);
      const res = await GET(mockRequest(failUrl) as never);
      expect(res.status).toBe(404);
    }
    // 6th attempt must be locked out.
    const { client } = makeOrderClient(null);
    vi.mocked(pool.connect).mockResolvedValueOnce(client as never);
    const res = await GET(mockRequest(failUrl) as never);
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error).toMatch(/قفل/);
  });

  it("does NOT lock on successful matches (counter only ticks on misses)", async () => {
    // Successful lookups return rows so the route never hits the
    // failure branch — 6 consecutive matches must all return 200.
    const orderRow = {
      id: "order-1",
      status: "pending",
      type: "delivery",
      total: "42.00",
      payment_method: "cash",
      guest_name: "ضيف",
      guest_phone: "0501234567",
      guest_city: "الرياض",
      guest_district: "العليا",
      tracking_code: "123456",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    const okUrl =
      "http://localhost/api/v1/orders/track?phone=%2B966501234567&code=123456";
    for (let i = 0; i < 6; i++) {
      const { client } = makeOrderClient(orderRow);
      vi.mocked(pool.connect).mockResolvedValueOnce(client as never);
      const res = await GET(mockRequest(okUrl) as never);
      expect(res.status).toBe(200);
    }
  });

  it("different (ip, code) keys are isolated — a 2nd code is not pre-locked", async () => {
    // 5 misses on code-A must not lock code-B for the same IP.
    for (let i = 0; i < 5; i++) {
      const { client } = makeOrderClient(null);
      vi.mocked(pool.connect).mockResolvedValueOnce(client as never);
      await GET(mockRequest(failUrl) as never);
    }
    // Different code, same phone/IP — first attempt should be 404, NOT 429.
    const otherCodeUrl =
      "http://localhost/api/v1/orders/track?phone=%2B966500000000&code=888888";
    const { client } = makeOrderClient(null);
    vi.mocked(pool.connect).mockResolvedValueOnce(client as never);
    const res = await GET(mockRequest(otherCodeUrl) as never);
    expect(res.status).toBe(404);
  });
});