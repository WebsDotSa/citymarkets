import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Regression tests for GET /api/v1/payments/status.
 *
 * Invariants under test:
 *   1. 401 for unauthenticated callers.
 *   2. 400 for missing order_id.
 *   3. 404 for orders the caller does not own — same response shape as
 *      "not found" so ownership is not enumerable.
 *   4. The response carries server-authoritative total + payment_method
 *      so the /checkout/pay inline screen can mount without trusting
 *      the caller.
 */

const mocks = vi.hoisted(() => ({
  poolQuery: vi.fn(),
  resolveCustomerUserIdFromRequest: vi.fn(),
  logError: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ pool: { query: mocks.poolQuery } }));
vi.mock('@/lib/identity', () => ({
  resolveCustomerUserIdFromRequest: mocks.resolveCustomerUserIdFromRequest,
}));
vi.mock("@/lib/logger", () => ({ error: mocks.logError }));

import { GET } from "./route";

function mockRequest(query: Record<string, string>): Request {
  const url = new URL("http://localhost/api/v1/payments/status");
  for (const [k, v] of Object.entries(query)) {
    url.searchParams.set(k, v);
  }
  return {
    url: url.toString(),
    headers: { get: () => null },
  } as unknown as Request;
}

const USER = "11111111-aaaa-bbbb-cccc-222222222222";
const ORDER = "22222222-aaaa-bbbb-cccc-333333333333";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.resolveCustomerUserIdFromRequest.mockResolvedValue(USER);
});

describe("GET /api/v1/payments/status", () => {
  it("returns 401 for unauthenticated callers", async () => {
    mocks.resolveCustomerUserIdFromRequest.mockResolvedValueOnce(null);
    const res = await GET(mockRequest({ order_id: ORDER }) as never);
    expect(res.status).toBe(401);
    expect(mocks.poolQuery).not.toHaveBeenCalled();
  });

  it("returns 400 when order_id is missing", async () => {
    const res = await GET(mockRequest({}) as never);
    expect(res.status).toBe(400);
    expect(mocks.poolQuery).not.toHaveBeenCalled();
  });

  it("returns 404 when the order belongs to another user", async () => {
    mocks.poolQuery.mockResolvedValueOnce({ rows: [] });
    const res = await GET(mockRequest({ order_id: ORDER }) as never);
    expect(res.status).toBe(404);
    expect(mocks.poolQuery).toHaveBeenCalledWith(
      expect.stringContaining("FROM orders"),
      [ORDER, USER],
    );
  });

  it("returns the canonical status payload with server-authoritative total", async () => {
    // The route makes two queries: orders (with ownership filter) then
    // order_items (for Meta Pixel content_ids). Provide a stub for each.
    mocks.poolQuery
      .mockResolvedValueOnce({
        rows: [
          {
            id: ORDER,
            status: "pending",
            payment_status: "unpaid",
            payment_method: "mada",
            payment_reference: null,
            total: "99.50",
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] });
    const res = await GET(mockRequest({ order_id: ORDER }) as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      success: true,
      order_id: ORDER,
      status: "pending",
      payment_status: "unpaid",
      payment_method: "mada",
      total: 99.5,
      items: [],
    });
  });

  it("returns 500 and logs the underlying error when the database throws", async () => {
    mocks.poolQuery.mockRejectedValueOnce(new Error("db down"));
    const res = await GET(mockRequest({ order_id: ORDER }) as never);
    expect(res.status).toBe(500);
    expect(mocks.logError).toHaveBeenCalled();
  });
});
