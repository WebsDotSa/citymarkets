import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Regression test for POST /api/admin/orders/[id]/items.
 *
 * The endpoint lets an authenticated admin add a new line item to a
 * direct order. It must:
 *   - 401/403 when the admin gate rejects the caller
 *   - 404 when the order doesn't exist
 *   - 400 when the body is missing both product_id and free_text
 *   - 409 when the order is delivered or cancelled
 *   - 201 on success, with the new itemId and a system chat message
 *
 * The route acquires a pool client (transactional), so we mock
 * `pool.connect` and the gate. SQL surface is intentionally minimal.
 */

type ClientCall = { sql: string; params: unknown[] };

const clientCalls: ClientCall[] = [];

function makeClient() {
  const conn = {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      clientCalls.push({ sql, params });
      const upper = sql.trim().toUpperCase();
      if (upper.startsWith("BEGIN") || upper.startsWith("COMMIT") || upper.startsWith("ROLLBACK")) {
        return { rows: [] };
      }
      if (upper.startsWith("SELECT ID, STATUS, TYPE FROM ORDERS")) {
        // FOR UPDATE lock — return a pending direct order by default.
        return {
          rows: [
            {
              id: "order-1",
              status: "pending",
              type: "direct",
            },
          ],
        };
      }
      if (upper.startsWith("INSERT INTO DIRECT_ORDER_ITEMS")) {
        return { rows: [{ id: "new-item-id" }] };
      }
      if (upper.startsWith("INSERT INTO DIRECT_ORDER_MESSAGES")) {
        return { rows: [] };
      }
      return { rows: [] };
    }),
    release: vi.fn(),
  };
  return conn;
}

const connectMock = vi.fn(async () => makeClient());
const requireAdminMock = vi.fn(async () => ({
  admin: {
    id: "admin-1",
    email: "admin@citymarkets.sa",
    name: "Test Admin",
  },
}));
const logAdminActionMock = vi.fn(async () => {});

vi.mock("@/lib/db", () => ({
  pool: { connect: (connectMock as unknown as (...a: unknown[]) => unknown) },
}));

vi.mock('@/lib/identity', () => ({
  requireAdminApi: (requireAdminMock as unknown as (...a: unknown[]) => unknown),
}));

vi.mock("@/lib/admin-audit", () => ({
  logAdminAction: (logAdminActionMock as unknown as (...a: unknown[]) => unknown),
}));

vi.mock("@/lib/logger", () => ({
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
}));

const { POST } = await import("@/app/api/admin/orders/[id]/items/route");

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/admin/orders/order-1/items", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  clientCalls.length = 0;
  connectMock.mockClear();
  requireAdminMock.mockClear();
  logAdminActionMock.mockClear();
});

describe("POST /api/admin/orders/[id]/items", () => {
  it("returns 401 when the admin gate returns a 401 NextResponse", async () => {
    const { NextResponse } = await import("next/server");
    requireAdminMock.mockResolvedValueOnce(
      NextResponse.json({ success: false, error: "غير مصرح" }, { status: 401 }) as never
    );
    const res = await POST(makeRequest({ free_text: "x" }) as never, {
      params: Promise.resolve({ id: "order-1" }),
    } as never);
    expect(res.status).toBe(401);
  });

  it("returns 400 when body has neither product_id nor free_text", async () => {
    const res = await POST(makeRequest({ quantity: 1 }) as never, {
      params: Promise.resolve({ id: "order-1" }),
    } as never);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.success).toBe(false);
  });

  it("returns 201 on happy path with free_text + unit_price", async () => {
    const res = await POST(
      makeRequest({ free_text: "كيلو سكر", quantity: 2, unit_price: 7.5 }) as never,
      { params: Promise.resolve({ id: "order-1" }) } as never
    );
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.itemId).toBe("new-item-id");

    // INSERT must include free_text + the admin-supplied unit_price.
    const insertItem = clientCalls.find((c) =>
      c.sql.toUpperCase().includes("INSERT INTO DIRECT_ORDER_ITEMS")
    );
    expect(insertItem).toBeDefined();
    expect(insertItem!.params).toContain("كيلو سكر");
    expect(insertItem!.params).toContain(7.5);

    // The chat message must be inserted with sender_type='admin'.
    const insertMsg = clientCalls.find((c) =>
      c.sql.toUpperCase().includes("INSERT INTO DIRECT_ORDER_MESSAGES")
    );
    expect(insertMsg).toBeDefined();
    expect(insertMsg!.sql.toLowerCase()).toContain("'admin'");

    // Audit log fired with the admin action + details.
    expect(logAdminActionMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: "admin-1" }),
      "add_direct_order_item",
      expect.objectContaining({ entityId: "order-1" })
    );
  });

  it("returns 409 when the order is in a terminal status (delivered)", async () => {
    // Override the SELECT FOR UPDATE mock for this test only.
    const overrideClient = {
      query: vi.fn(async (sql: string, params: unknown[] = []) => {
        clientCalls.push({ sql, params });
        const upper = sql.trim().toUpperCase();
        if (upper.startsWith("BEGIN") || upper.startsWith("COMMIT") || upper.startsWith("ROLLBACK")) {
          return { rows: [] };
        }
        if (upper.startsWith("SELECT ID, STATUS, TYPE FROM ORDERS")) {
          return { rows: [{ id: "order-1", status: "delivered", type: "direct" }] };
        }
        return { rows: [] };
      }),
      release: vi.fn(),
    };
    connectMock.mockResolvedValueOnce(overrideClient as never);

    const res = await POST(
      makeRequest({ free_text: "x", quantity: 1 }) as never,
      { params: Promise.resolve({ id: "order-1" }) } as never
    );
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.error).toMatch(/منتهي/);
  });
});
