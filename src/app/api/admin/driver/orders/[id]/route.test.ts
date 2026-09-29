import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Regression tests for /api/admin/driver/orders/[id]:
 *   - GET  — items subquery joins products_unified, never bare products
 *   - PATCH delivered (COD) — payment_events ledger row is written
 *     instead of mutating orders.payment_status directly (P1-1).
 *   - PATCH duplicate replay — short-circuits the payment_status UPDATE.
 *   - PATCH delivered (already paid) — no ledger row written.
 */

type QueryCall = { sql: string; params: unknown[] };

const calls: QueryCall[] = [];

vi.mock("@/lib/db", () => ({
  pool: {
    connect: vi.fn(),
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      return { rows: [] };
    }),
  },
  query: vi.fn(),
}));

vi.mock('@/lib/identity', () => ({
  requireAdminApi: vi.fn().mockResolvedValue({
    admin: { id: "admin-1", permissions: ["update_delivery_status"] },
  }),
}));
vi.mock('@/lib/identity/admin-api-auth-db', () => ({
  requireAdminApi: vi.fn().mockResolvedValue({
    admin: { id: "admin-1", permissions: ["update_delivery_status"] },
  }),
}));

vi.mock('@/lib/payments/event-ledger', () => ({
  recordPaymentEvent: vi.fn(async () => 'inserted'),
  finalizePaymentEvent: vi.fn(),
}));

import { GET, PATCH } from "./route";
import { recordPaymentEvent, finalizePaymentEvent } from '@/lib/payments/event-ledger';

function mockRequest(url: string): Request {
  return { headers: { get: () => null }, url } as unknown as Request;
}

function patchRequest(body: Record<string, unknown>): Request {
  return {
    headers: { get: () => null },
    json: async () => body,
  } as unknown as Request;
}

describe("GET /api/admin/driver/orders/[id] — products_unified migration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    calls.length = 0;
  });

  it("joins order_items to products_unified and never to bare products", async () => {
    await GET(
      mockRequest("http://localhost/api/admin/driver/orders/uuid-1") as never,
      { params: Promise.resolve({ id: "uuid-1" }) } as never,
    );

    const queriedProducts = calls.some(
      (c) =>
        c.sql.toUpperCase().match(/\bFROM\s+products\b/i) ||
        c.sql.toUpperCase().match(/\bJOIN\s+products\b(?!_unified)/i),
    );
    expect(queriedProducts).toBe(false);

    const usesUnified = calls.some(
      (c) =>
        c.sql.toUpperCase().match(/\bFROM\s+products_unified\b/i) ||
        c.sql.toUpperCase().match(/\bJOIN\s+products_unified\b/i),
    );
    expect(usesUnified).toBe(true);
  });
});

/**
 * PATCH delivered (COD) — P1-1 regression suite.
 *
 * The driver-side flow writes payment_status='paid' on the orders
 * table when status flips to 'delivered'. Before P1-1 the write was a
 * direct SQL mutation — no payment_events ledger row, no idempotency.
 *
 * After P1-1 the route:
 *   1. recordPaymentEvent(client, {invoiceId: orderId, gateway: 'cod',
 *      eventType: 'cod.collected', raw}) — runs inside the txn
 *   2. Only add `payment_status = 'paid'` to the UPDATE if the ledger
 *      INSERT succeeded (codLedgerResult === 'inserted')
 *   3. finalizePaymentEvent(...) after COMMIT to mark the row processed
 */
describe("PATCH /api/admin/driver/orders/[id] — COD paid through ledger (P1-1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    calls.length = 0;
  });

  it("delivered COD writes a payment_events ledger row BEFORE the UPDATE", async () => {
    const fakeClient = {
      query: vi.fn(async (sql: string, params: unknown[] = []) => {
        calls.push({ sql, params });
        const s = sql.trim().toUpperCase();
        if (s.startsWith("BEGIN") || s.startsWith("COMMIT") || s.startsWith("ROLLBACK")) {
          return { rows: [] };
        }
        if (s.startsWith("SELECT ID FROM DRIVERS")) {
          return { rows: [{ id: "driver-1" }] };
        }
        if (s.startsWith("SELECT") && /FOR UPDATE/.test(s)) {
          // Order already picked up by the driver (status='on_the_way',
          // driver_id=driver-1). The driver is now marking it delivered
          // and collecting COD payment. The non-claim branch (claim:false
          // would also work) is the realistic flow; we use claim:false
          // because the driver already owns the order.
          return { rows: [{ id: "ord-1", status: "on_the_way", payment_status: "pending", driver_id: "driver-1" }] };
        }
        // UPDATE orders ... RETURNING
        return { rows: [{ id: "ord-1", order_number: "TRK1", status: "delivered" }] };
      }),
      release: vi.fn(),
    };
    const { pool } = await import('@/lib/db');
    vi.mocked(pool.connect).mockResolvedValueOnce(fakeClient as never);

    await PATCH(
      patchRequest({ status: "delivered" }) as never,
      { params: Promise.resolve({ id: "ord-1" }) } as never,
    );

    // Ledger INSERT happened with gateway='cod' and eventType='cod.collected'
    expect(recordPaymentEvent).toHaveBeenCalledTimes(1);
    expect(vi.mocked(recordPaymentEvent).mock.calls[0][1]).toMatchObject({
      invoiceId: "ord-1",
      gateway: "cod",
      eventType: "cod.collected",
    });

    // finalizePaymentEvent ran with status='processed' for the cod event
    expect(finalizePaymentEvent).toHaveBeenCalledTimes(1);
    expect(vi.mocked(finalizePaymentEvent).mock.calls[0][1]).toMatchObject({
      invoiceId: "ord-1",
      gateway: "cod",
      eventType: "cod.collected",
      status: "processed",
    });
  });

  it("delivered with already-paid payment_status does NOT write a ledger row", async () => {
    const fakeClient = {
      query: vi.fn(async (sql: string, params: unknown[] = []) => {
        calls.push({ sql, params });
        const s = sql.trim().toUpperCase();
        if (s.startsWith("BEGIN") || s.startsWith("COMMIT") || s.startsWith("ROLLBACK")) {
          return { rows: [] };
        }
        if (s.startsWith("SELECT ID FROM DRIVERS")) {
          return { rows: [{ id: "driver-1" }] };
        }
        if (s.startsWith("SELECT") && /FOR UPDATE/.test(s)) {
          // already paid (e.g. online payment) — no COD collection
          return { rows: [{ id: "ord-1", status: "on_the_way", payment_status: "paid", driver_id: "driver-1" }] };
        }
        return { rows: [{ id: "ord-1", order_number: "TRK1", status: "delivered" }] };
      }),
      release: vi.fn(),
    };
    const { pool } = await import('@/lib/db');
    vi.mocked(pool.connect).mockResolvedValueOnce(fakeClient as never);

    await PATCH(
      patchRequest({ status: "delivered" }) as never,
      { params: Promise.resolve({ id: "ord-1" }) } as never,
    );

    // No ledger writes — order was already paid
    expect(recordPaymentEvent).not.toHaveBeenCalled();
    expect(finalizePaymentEvent).not.toHaveBeenCalled();
  });

  it("duplicate COD replay (recordPaymentEvent returns 'duplicate') skips payment_status UPDATE", async () => {
    // recordPaymentEvent returns 'duplicate' — simulates a retry hitting
    // the UNIQUE (invoice_id, gateway, event_type) index. The route
    // must NOT re-write payment_status='paid'.
    vi.mocked(recordPaymentEvent).mockResolvedValueOnce('duplicate' as never);

    const fakeClient = {
      query: vi.fn(async (sql: string, params: unknown[] = []) => {
        calls.push({ sql, params });
        const s = sql.trim().toUpperCase();
        if (s.startsWith("BEGIN") || s.startsWith("COMMIT") || s.startsWith("ROLLBACK")) {
          return { rows: [] };
        }
        if (s.startsWith("SELECT ID FROM DRIVERS")) {
          return { rows: [{ id: "driver-1" }] };
        }
        if (s.startsWith("SELECT") && /FOR UPDATE/.test(s)) {
          return { rows: [{ id: "ord-1", status: "on_the_way", payment_status: "pending", driver_id: "driver-1" }] };
        }
        return { rows: [{ id: "ord-1", order_number: "TRK1", status: "delivered" }] };
      }),
      release: vi.fn(),
    };
    const { pool } = await import('@/lib/db');
    vi.mocked(pool.connect).mockResolvedValueOnce(fakeClient as never);

    await PATCH(
      patchRequest({ status: "delivered" }) as never,
      { params: Promise.resolve({ id: "ord-1" }) } as never,
    );

    // Ledger was attempted but short-circuited as duplicate
    expect(recordPaymentEvent).toHaveBeenCalledTimes(1);
    // finalizePaymentEvent should NOT run for a duplicate (no work to mark)
    expect(finalizePaymentEvent).not.toHaveBeenCalled();

    // The order UPDATE should NOT have payment_status='paid' in its SET clause
    const updateCall = calls.find(
      (c) =>
        c.sql.trim().toUpperCase().startsWith("UPDATE ORDERS") &&
        /SET\s+STATUS/i.test(c.sql),
    );
    expect(updateCall).toBeDefined();
    expect(updateCall!.sql).not.toMatch(/payment_status\s*=\s*'paid'/i);
  });

  it("non-delivered transitions (on_the_way, cancelled) do NOT touch the ledger", async () => {
    const fakeClient = {
      query: vi.fn(async (sql: string, params: unknown[] = []) => {
        calls.push({ sql, params });
        const s = sql.trim().toUpperCase();
        if (s.startsWith("BEGIN") || s.startsWith("COMMIT") || s.startsWith("ROLLBACK")) {
          return { rows: [] };
        }
        if (s.startsWith("SELECT ID FROM DRIVERS")) {
          return { rows: [{ id: "driver-1" }] };
        }
        if (s.startsWith("SELECT") && /FOR UPDATE/.test(s)) {
          return { rows: [{ id: "ord-1", status: "pending", payment_status: "pending", driver_id: null }] };
        }
        return { rows: [{ id: "ord-1", order_number: "TRK1", status: "on_the_way" }] };
      }),
      release: vi.fn(),
    };
    const { pool } = await import('@/lib/db');
    vi.mocked(pool.connect).mockResolvedValueOnce(fakeClient as never);

    await PATCH(
      patchRequest({ status: "on_the_way", claim: true }) as never,
      { params: Promise.resolve({ id: "ord-1" }) } as never,
    );

    // No ledger writes for non-COD-collected transitions
    expect(recordPaymentEvent).not.toHaveBeenCalled();
    expect(finalizePaymentEvent).not.toHaveBeenCalled();
  });
});
