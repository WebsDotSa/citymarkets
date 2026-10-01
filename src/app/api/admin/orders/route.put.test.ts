import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Regression test for PCP-76.F6 / PCP-98.
 *
 * Background — the old PUT handler did an unlocked SELECT against `orders`
 * to capture `oldStatus`, then ran the state-machine guard, then ran the
 * UPDATE in a separate autocommit statement. Two concurrent admins could
 * both pass the guard (each reading a different in-flight snapshot) and
 * overwrite each other's transition — the state-machine guard was
 * effectively advisory.
 *
 * The fix wraps the read + state-machine check + UPDATE +
 * order_status_logs INSERT in a single transaction with SELECT ... FOR
 * UPDATE on the row lock. These tests pin down the contract:
 *
 *   1. The handler MUST take a client from the pool (pool.connect()).
 *   2. That client's queries MUST be wrapped in BEGIN ... COMMIT.
 *   3. The status read MUST use FOR UPDATE.
 *   4. The order_status_logs INSERT MUST be inside the same transaction
 *      (atomic with the UPDATE), not in a separate best-effort block.
 *
 * If a future refactor silently reverts the fix (e.g. drops FOR UPDATE,
 * or splits the log INSERT back into a separate autocommit statement),
 * these tests fail and the audit channel flags the issue.
 */

type QueryCall = { sql: string; params: unknown[] };
type ClientCall = { sql: string; params: unknown[] };

const txClientCalls: ClientCall[] = [];
const poolCalls: QueryCall[] = [];

const mockConnect = vi.fn();

vi.mock("@/lib/db", () => ({
  pool: {
    connect: (...args: unknown[]) => {
      mockConnect(...args);
      return {
        query: async (sql: string, params: unknown[] = []) => {
          txClientCalls.push({ sql, params });
          const s = sql.trim().toUpperCase();
          // Tx-control statements are no-ops in the mock.
          if (s === "BEGIN" || s === "COMMIT" || s === "ROLLBACK") {
            return { rows: [] };
          }
          // Locked order row used by the FOR UPDATE read inside the tx.
          if (s.includes("FROM ORDERS") && s.includes("FOR UPDATE")) {
            return {
              rows: [{ status: "pending", driver_id: null }],
            };
          }
          // UPDATE orders within the tx.
          if (s.startsWith("UPDATE ORDERS")) {
            return { rows: [] };
          }
          // order_status_logs INSERT within the tx.
          if (s.startsWith("INSERT INTO ORDER_STATUS_LOGS")) {
            return { rows: [] };
          }
          return { rows: [] };
        },
        release: vi.fn(),
      };
    },
  },
  query: vi.fn(async (sql: string, params: unknown[] = []) => {
    poolCalls.push({ sql, params });
    // Driver lookup, loyalty, anything else that runs on the pool query
    // helper rather than the tx client.
    return { rows: [] };
  }),
}));

vi.mock("@/lib/identity", () => ({
  requireAdminApi: vi.fn(),
}));
vi.mock("@/lib/identity/admin-api-auth-db", () => ({
  requireAdminApi: vi.fn().mockResolvedValue({
    admin: { id: "admin-1", role: "admin", permissions: ["manage_orders"] },
  }),
}));

vi.mock("@/lib/admin-audit", () => ({
  logAdminAction: vi.fn(),
}));

vi.mock("@/lib/validation", () => ({
  updateOrderSchema: {
    safeParse: vi.fn().mockReturnValue({
      success: true,
      data: { status: "confirmed" },
    }),
  },
}));

// best-effort loggers / state machine — keep silent.
vi.mock("@/lib/logger", () => ({
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
}));
vi.mock("@/lib/orders/state-machine", () => ({
  ALL_ORDER_STATES: [
    "pending",
    "confirmed",
    "preparing",
    "ready",
    "out_for_delivery",
    "delivered",
    "cancelled",
  ],
  ALL_PAYMENT_STATES: ["pending", "paid", "failed", "refunded"],
  assertValidTransition: () => undefined,
  invalidTransitionMessage: () => "invalid transition",
}));

vi.mock("@/lib/orders/sql-fragments", () => ({
  ORDER_BASE_COLUMNS: "o.id, o.status",
  ORDER_LIST_COLUMNS: "o.id, o.status",
  ORDER_ADDRESS_COLUMNS: "a.id",
  ORDER_USER_COLUMNS: "u.id",
  ORDER_DETAIL_JOINS: "FROM orders o",
  ORDER_LIST_JOINS: "FROM orders o",
}));

import { PUT } from "./route";

function mockPutRequest(url: string, body: unknown): Request {
  return {
    headers: { get: () => null },
    url,
    json: async () => body,
  } as unknown as Request;
}

describe("PUT /api/admin/orders — PCP-76.F6 tx wrapping (PCP-98)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    txClientCalls.length = 0;
    poolCalls.length = 0;
  });

  it("acquires a tx client from pool.connect()", async () => {
    await PUT(
      mockPutRequest(
        "http://localhost/api/admin/orders?id=order-uuid-1",
        { status: "confirmed" },
      ) as never,
    );
    expect(mockConnect).toHaveBeenCalledTimes(1);
  });

  it("wraps the read+update+audit sequence in BEGIN ... COMMIT", async () => {
    await PUT(
      mockPutRequest(
        "http://localhost/api/admin/orders?id=order-uuid-1",
        { status: "confirmed" },
      ) as never,
    );

    const sqls = txClientCalls.map((c) => c.sql.trim().toUpperCase());
    expect(sqls[0]).toBe("BEGIN");
    expect(sqls[sqls.length - 1]).toBe("COMMIT");
    // Must not silently end on ROLLBACK in the happy path.
    expect(sqls[sqls.length - 1]).not.toBe("ROLLBACK");
  });

  it("uses SELECT ... FOR UPDATE on the orders row before UPDATE", async () => {
    await PUT(
      mockPutRequest(
        "http://localhost/api/admin/orders?id=order-uuid-1",
        { status: "confirmed" },
      ) as never,
    );

    const forUpdateIdx = txClientCalls.findIndex(
      (c) =>
        c.sql.trim().toUpperCase().includes("FROM ORDERS") &&
        c.sql.trim().toUpperCase().includes("FOR UPDATE"),
    );
    const updateIdx = txClientCalls.findIndex(
      (c) => c.sql.trim().toUpperCase().startsWith("UPDATE ORDERS"),
    );

    expect(forUpdateIdx).toBeGreaterThanOrEqual(0);
    expect(updateIdx).toBeGreaterThanOrEqual(0);
    // FOR UPDATE must come before the UPDATE so the lock covers the
    // window in which the state-machine guard runs.
    expect(forUpdateIdx).toBeLessThan(updateIdx);
  });

  it("writes the order_status_logs row inside the same transaction", async () => {
    await PUT(
      mockPutRequest(
        "http://localhost/api/admin/orders?id=order-uuid-1",
        { status: "confirmed" },
      ) as never,
    );

    const beginIdx = txClientCalls.findIndex(
      (c) => c.sql.trim().toUpperCase() === "BEGIN",
    );
    const commitIdx = txClientCalls.findIndex(
      (c) => c.sql.trim().toUpperCase() === "COMMIT",
    );
    const logInsertIdx = txClientCalls.findIndex(
      (c) =>
        c.sql.trim().toUpperCase().startsWith("INSERT INTO ORDER_STATUS_LOGS"),
    );

    expect(logInsertIdx).toBeGreaterThan(beginIdx);
    expect(logInsertIdx).toBeLessThan(commitIdx);
  });
});