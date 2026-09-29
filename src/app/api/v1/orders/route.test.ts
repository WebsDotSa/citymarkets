import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Regression tests for /api/v1/orders.
 *
 * Two independent contracts are guarded here:
 *
 *  1. POST accepts only canonical UUID `product_id` values in the
 *     request body. Non-UUID values must be rejected with 400 and a
 *     rolled-back transaction — never silently coerced.
 *
 *  2. GET joins `order_items` to `products_unified` (NOT bare
 *     `products`). This pins the products→products_unified migration
 *     in place so a regression cannot silently re-introduce the
 *     legacy table reference.
 *
 * The route hits the database, so we mock `pool.connect` to capture
 * the query plan without actually running SQL. We also mock the
 * auth/session helpers so the route thinks a customer is signed in.
 */

type QueryCall = { sql: string; params: unknown[] };

function makeFakeClient(opts?: { validProduct?: boolean }) {
  const calls: QueryCall[] = [];
  const client = {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      const s = sql.trim().toUpperCase();

      if (s.startsWith("BEGIN") || s.startsWith("ROLLBACK") || s.startsWith("COMMIT")) {
        return { rows: [] };
      }
      // SELECT against products_unified — return a single product
      // when the test wants the happy path; empty otherwise.
      if (s.includes("FROM PRODUCTS_UNIFIED")) {
        if (opts?.validProduct) {
          return {
            rows: [
              {
                product_id: params[0],
                price: "10.00",
                discount_price: null,
                stock_qty: "100",
                name_ar: "منتج تجريبي",
                is_active: true,
              },
            ],
          };
        }
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

vi.mock('@/lib/identity', () => ({
  resolveCustomerUserIdFromRequest: vi.fn(),
  getGuestSessionIdFromRequest: vi.fn(),
}));

vi.mock("@/lib/logger", () => ({
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
}));

import { pool } from "@/lib/db";
import {
  resolveCustomerUserIdFromRequest,
  getGuestSessionIdFromRequest,
} from '@/lib/identity';
import { POST, GET } from "./route";
import type { NextRequest } from "next/server";

function mockRequest(body: unknown): NextRequest {
  return {
    headers: { get: () => null },
    json: async () => body,
  } as unknown as NextRequest;
}

const VALID_UUID = "11111111-2222-3333-4444-555555555555";
const LEGACY_INT = "42";

describe("POST /api/v1/orders — UUID pre-flight (regression: معرّف غير صالح)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveCustomerUserIdFromRequest).mockResolvedValue("user-1");
    vi.mocked(getGuestSessionIdFromRequest).mockResolvedValue(null);
  });

  it("accepts a body where every product_id is a canonical UUID", async () => {
    const { client, calls } = makeFakeClient({ validProduct: true });
    vi.mocked(pool.connect).mockResolvedValueOnce(client as never);

    const res = await POST(
      mockRequest({
        items: [{ product_id: VALID_UUID, quantity: 1 }],
        paymentMethod: "cash",
        addressId: "addr-1",
      }) as never
    );

    // The pre-flight should NOT trigger — the products_unified query
    // should run, which means our test plumbing reached the
    // downstream logic.
    const queriedProducts = calls.some((c) =>
      c.sql.toUpperCase().includes("FROM PRODUCTS_UNIFIED")
    );
    expect(queriedProducts).toBe(true);
    // The pre-flight error string must not be returned for a valid UUID.
    if (res.status === 400) {
      const body = await res.clone().json();
      expect(body.error).not.toBe("منتجات غير صالحة");
    }
  });

  it("rejects a mixed list containing a non-UUID product_id with 400 and a ROLLBACK", async () => {
    const { client, calls } = makeFakeClient();
    vi.mocked(pool.connect).mockResolvedValueOnce(client as never);

    const res = await POST(
      mockRequest({
        items: [
          { product_id: VALID_UUID, quantity: 1 },
          { product_id: LEGACY_INT, quantity: 1 }, // legacy integer id
        ],
        paymentMethod: "cash",
        addressId: "addr-1",
      }) as never
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect([
      "معرّف المنتج غير صالح",
      "منتجات غير صالحة",
    ]).toContain(body.error);

    // Pre-flight must reject BEFORE the products_unified query is
    // ever issued. (Note: Zod may short-circuit even before the
    // manual pre-flight, in which case no transaction is opened at
    // all — both behaviors are correct, as long as no products query
    // runs against an invalid id.)
    const queriedProducts = calls.some((c) =>
      c.sql.toUpperCase().includes("FROM PRODUCTS_UNIFIED")
    );
    expect(queriedProducts).toBe(false);

    // If a transaction was opened for this request, it must be
    // rolled back (or rolled forward to COMMIT) — never left open.
    const opened = calls.some((c) =>
      c.sql.trim().toUpperCase().startsWith("BEGIN")
    );
    if (opened) {
      const closed = calls.some(
        (c) =>
          c.sql.trim().toUpperCase().startsWith("ROLLBACK") ||
          c.sql.trim().toUpperCase().startsWith("COMMIT")
      );
      expect(closed).toBe(true);
    }
  });

  it("rejects a body with no product_ids at all (all non-UUID)", async () => {
    const { client } = makeFakeClient();
    vi.mocked(pool.connect).mockResolvedValueOnce(client as never);

    const res = await POST(
      mockRequest({
        items: [{ product_id: "not-a-uuid", quantity: 1 }],
        paymentMethod: "cash",
        addressId: "addr-1",
      }) as never
    );

    // Either Zod's per-field message ("معرّف المنتج غير صالح") or
    // the manual pre-flight ("منتجات غير صالحة") is acceptable —
    // both are valid 400 responses. What we MUST NOT see is a 200 or
    // a 500.
    expect(res.status).toBe(400);
    const body = await res.json();
    expect([
      "معرّف المنتج غير صالح",
      "منتجات غير صالحة",
    ]).toContain(body.error);
  });

  it("accepts only canonical 8-4-4-4-12 UUIDs (rejects short hex strings)", async () => {
    const { client } = makeFakeClient();
    vi.mocked(pool.connect).mockResolvedValueOnce(client as never);

    const res = await POST(
      mockRequest({
        items: [{ product_id: "deadbeef", quantity: 1 }],
        paymentMethod: "cash",
        addressId: "addr-1",
      }) as never
    );

    expect(res.status).toBe(400);
  });
});

/**
 * Regression: GET /api/v1/orders — products → products_unified migration.
 *
 * The GET handler joins `order_items` to the products catalog so
 * each row in the response can carry `name_ar` / `image_url`. The
 * migration replaced the bare `products` table with the
 * `products_unified` view.
 *
 * This block pins down the contract:
 *   1. The handler requires an authenticated customer (401 otherwise).
 *   2. On success, the captured SQL must JOIN `products_unified`.
 *   3. No SQL string may reference bare `products` (no `_unified`
 *      suffix) — guards against a re-introduction of the legacy table.
 */
describe("GET /api/v1/orders — products_unified migration (regression)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when no customer is resolved", async () => {
    vi.mocked(resolveCustomerUserIdFromRequest).mockResolvedValue(null);

    const res = await GET({
      headers: { get: () => null },
      url: "http://localhost/api/v1/orders",
    } as never);
    expect(res.status).toBe(401);
  });

  it("joins order_items to products_unified (not bare products)", async () => {
    vi.mocked(resolveCustomerUserIdFromRequest).mockResolvedValue("user-1");

    const { client, calls } = makeFakeClient();
    // Replace the implementation wholesale — a defensive
    // mockReset + re-mock prevents any stale state (e.g. a
    // mockResolvedValueOnce queue from the POST describe block)
    // from leaking into this test.
    vi.mocked(pool.connect).mockReset();
    vi.mocked(pool.connect).mockImplementation(async () => client as never);

    const res = await GET({
      headers: { get: () => null },
      url: "http://localhost/api/v1/orders",
    } as never);
    expect(res.status).toBe(200);

    // Migration target: at least one call must JOIN products_unified.
    const usesUnified = calls.some((c) =>
      /\bFROM\s+products_unified\b/i.test(c.sql) ||
      /\bJOIN\s+products_unified\b/i.test(c.sql)
    );
    expect(usesUnified).toBe(true);

    // Negative guarantee: no SQL string references bare `products`
    // (without `_unified` suffix).
    const usesBareProducts = calls.some((c) =>
      /\bFROM\s+products\b(?!_unified)/i.test(c.sql) ||
      /\bJOIN\s+products\b(?!_unified)/i.test(c.sql)
    );
    expect(usesBareProducts).toBe(false);
  });
});
