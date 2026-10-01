import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PoolClient } from "pg";

/**
 * Tests for `reconcilePayment` — the shared payment-reconciliation
 * helper extracted from the Moyasar + Tamara webhooks (P1-5). The
 * helper is the single source of truth for:
 *   - ledger INSERT (with duplicate short-circuit)
 *   - per-order advisory lock
 *   - parent + child payment_status mirror (CASE-guarded)
 *   - paid-only lifecycle flip + loyalty + abandoned-cart recovery
 *
 * The goal of these tests is to pin the SQL contract so a future
 * "cleanup" can't drift the helper away from the consumer webhooks.
 */

vi.mock("@/lib/orders/loyalty", () => ({
  awardPointsForOrder: vi.fn(async () => ({ awarded: 0, duplicate: false })),
  getLoyaltySettings: vi.fn(async () => ({
    enabled: true,
    earn_points_per_sar: 0.1,
    redeem_value_per_point: 0.05,
    min_redeem_points: 100,
    max_redeem_percent: 0.5,
  })),
  resolveRedeemForOrder: vi.fn(async () => ({ debited: 0, duplicate: false })),
}));

const mockMarkRecovered = vi.fn(async (_client?: unknown, _args?: unknown) => ({ recovered_count: 1 }));
vi.mock("@/lib/orders/abandoned-carts", () => ({
  markAbandonedCartRecovered: (...args: unknown[]) =>
    (mockMarkRecovered as unknown as (...a: unknown[]) => Promise<{ recovered_count: number }>)(...args),
}));

vi.mock("@/lib/logger", () => ({
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
}));

import { reconcilePayment } from "./reconcile-payment";

type QueryCall = { sql: string; params: unknown[] };

function makeMockClient() {
  const calls: QueryCall[] = [];
  // Each `query` call consumes one mock return from `queue` (FIFO).
  // `throwOnce` makes the FIRST ledger INSERT throw a 23505 so the
  // helper's `catch (e) => e.code === '23505'` branch fires.
  const queue: Array<{ rowCount: number; rows: unknown[] }> = [];
  let throwOnce = false;
  const client = {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      const s = sql.trim().toUpperCase();
      if (s.startsWith("INSERT INTO PAYMENT_EVENTS")) {
        if (throwOnce) {
          throwOnce = false;
          const err = Object.assign(new Error("duplicate"), { code: "23505" });
          throw err;
        }
        return queue.shift() ?? { rowCount: 1, rows: [] };
      }
      return { rowCount: 1, rows: [] };
    }),
    release: vi.fn(),
  };
  return {
    client: client as unknown as PoolClient,
    calls,
    enqueue: (responses: Array<{ rowCount: number; rows: unknown[] }>) => {
      queue.push(...responses);
    },
    simulateDuplicate: () => {
      throwOnce = true;
    },
  };
}

const baseOrderRow = {
  id: "order-1",
  total: 100,
  catalog_subtotal: 100,
  user_id: "user-1",
  points_redeemed: 0,
  guest_phone: "0501234567",
};

beforeEach(() => {
  vi.clearAllMocks();
  mockMarkRecovered.mockResolvedValue({ recovered_count: 1 });
});

describe("reconcilePayment", () => {
  it("records event, locks, mirrors paid status, and runs paid-only side effects", async () => {
    const { client, calls } = makeMockClient();
    // First query is the ledger INSERT → inserted (rowCount=1)
    // All subsequent queries are advisory lock / UPDATE — handled by
    // the catch-all default in makeMockClient.

    const result = await reconcilePayment(client, {
      invoiceId: "inv-1",
      gateway: "moyasar",
      eventType: "payment.paid",
      paymentDb: "paid",
      rawBody: { foo: "bar" },
      orderRow: baseOrderRow,
    });

    expect(result).toEqual({ recoveredCount: 1, duplicate: false });

    // Ledger INSERT ran first with the right args
    const ledgerInsert = calls[0];
    expect(ledgerInsert.sql).toMatch(/INSERT INTO payment_events/i);
    expect(ledgerInsert.params.slice(0, 4)).toEqual([
      "inv-1",
      "moyasar",
      "payment.paid",
      JSON.stringify({ foo: "bar" }),
    ]);

    // Advisory lock follows immediately after the ledger INSERT
    const lock = calls[1];
    expect(lock.sql).toMatch(/pg_advisory_xact_lock/);
    expect(lock.params).toEqual(["order:order-1"]);

    // orders + vendor_orders payment_status mirror uses CASE
    const ordersUpdate = calls.find((c) =>
      /^UPDATE orders\s+SET payment_status/i.test(c.sql.trim()),
    );
    expect(ordersUpdate).toBeDefined();
    expect(ordersUpdate!.params).toEqual(["paid", "order-1"]);

    const vendorUpdate = calls.find((c) =>
      /^UPDATE vendor_orders/i.test(c.sql.trim()) &&
      c.sql.includes("payment_status"),
    );
    expect(vendorUpdate).toBeDefined();
    expect(vendorUpdate!.params).toEqual(["paid", "order-1"]);

    // Paid-only: lifecycle flip — now a CTE that does UPDATE +
    // conditional order_status_logs INSERT atomically.
    const lifecycle = calls.find((c) =>
      /WITH old AS[\s\S]*UPDATE orders\s+SET status/i.test(c.sql),
    );
    expect(lifecycle).toBeDefined();
    // The CTE must include the conditional order_status_logs INSERT
    // with `changed_by = 'system:payment_webhook'`.
    expect(lifecycle!.sql).toMatch(/INSERT INTO order_status_logs/i);
    expect(lifecycle!.sql).toMatch(/'system:payment_webhook'/i);
    // The conditional INSERT only fires when old.status = 'pending'
    // — replay safety for duplicate paid webhooks.
    expect(lifecycle!.sql).toMatch(/WHERE old\.status = 'pending'/i);
    // Params: orderId + notes string
    expect(lifecycle!.params).toEqual([
      "order-1",
      "moyasar:payment.paid → parent pending → confirmed",
    ]);
  });

  it("writes an order_status_logs row on paid webhook (parent pending → confirmed)", async () => {
    const { client, calls } = makeMockClient();
    await reconcilePayment(client, {
      invoiceId: "inv-audit-1",
      gateway: "moyasar",
      eventType: "payment.paid",
      paymentDb: "paid",
      rawBody: { foo: "bar" },
      orderRow: baseOrderRow,
    });
    const audit = calls.find(
      (c) => /INSERT INTO order_status_logs/i.test(c.sql),
    );
    expect(audit).toBeDefined();
    expect(audit!.sql).toMatch(/'system:payment_webhook'/i);
    // Old status is captured from the pre-update CTE, new status is
    // the literal 'confirmed'.
    expect(audit!.sql).toMatch(/new_status/i);
    expect(audit!.sql).toMatch(/'confirmed'/);
  });

  it("tamara approved webhook also writes the parent status log", async () => {
    const { client, calls } = makeMockClient();
    await reconcilePayment(client, {
      invoiceId: "inv-audit-tamara",
      gateway: "tamara",
      eventType: "tamara.captured",
      paymentDb: "paid",
      rawBody: {},
      orderRow: baseOrderRow,
    });
    const audit = calls.find(
      (c) => /INSERT INTO order_status_logs/i.test(c.sql),
    );
    expect(audit).toBeDefined();
    expect(audit!.params[1]).toMatch(/^tamara:tamara\.captured /);
  });

  it("skips paid-only side effects when paymentDb is 'failed'", async () => {
    const { client, calls } = makeMockClient();
    const result = await reconcilePayment(client, {
      invoiceId: "inv-2",
      gateway: "tamara",
      eventType: "tamara.declined",
      paymentDb: "failed",
      rawBody: {},
      orderRow: baseOrderRow,
    });
    expect(result).toEqual({ recoveredCount: 0, duplicate: false });

    // No lifecycle flip on failure
    const lifecycle = calls.find((c) =>
      /^UPDATE orders\s+SET status/i.test(c.sql.trim()),
    );
    expect(lifecycle).toBeUndefined();

    // markAbandonedCartRecovered NOT called
    expect(mockMarkRecovered).not.toHaveBeenCalled();
  });

  it("returns duplicate=true and skips everything when ledger short-circuits", async () => {
    const { client, calls, simulateDuplicate } = makeMockClient();
    simulateDuplicate();

    const result = await reconcilePayment(client, {
      invoiceId: "inv-3",
      gateway: "moyasar",
      eventType: "payment.paid",
      paymentDb: "paid",
      rawBody: {},
      orderRow: baseOrderRow,
    });

    expect(result).toEqual({ recoveredCount: 0, duplicate: true });

    // Ledger INSERT ran first (then a ledger UPDATE for finalize),
    // but NO advisory lock + NO order/vendor UPDATE.
    expect(calls).toHaveLength(2);
    expect(calls[0].sql).toMatch(/INSERT INTO payment_events/i);
    expect(calls[1].sql).toMatch(/UPDATE payment_events/i);

    expect(mockMarkRecovered).not.toHaveBeenCalled();
  });

  it("guards payment_status mirror against regressing paid/failed back to pending", async () => {
    const { client, calls } = makeMockClient();
    await reconcilePayment(client, {
      invoiceId: "inv-4",
      gateway: "moyasar",
      eventType: "payment.notification",
      paymentDb: "pending",
      rawBody: {},
      orderRow: baseOrderRow,
    });
    const ordersUpdate = calls.find((c) =>
      /^UPDATE orders\s+SET payment_status/i.test(c.sql.trim()),
    )!;
    // The CASE expression must guard paid/failed from being overwritten
    expect(ordersUpdate.sql).toMatch(/WHEN payment_status = 'paid'\s+THEN 'paid'/i);
    expect(ordersUpdate.sql).toMatch(/WHEN payment_status = 'failed' AND \$1 = 'pending' THEN 'failed'/i);
    expect(ordersUpdate.params).toEqual(["pending", "order-1"]);
  });

  it("uses order.id from the orderRow (not re-SELECT) so caller's lock window is honoured", async () => {
    const { client, calls } = makeMockClient();
    const orderRowWithOtherId = { ...baseOrderRow, id: "other-9" };
    await reconcilePayment(client, {
      invoiceId: "inv-5",
      gateway: "tamara",
      eventType: "tamara.captured",
      paymentDb: "paid",
      rawBody: {},
      orderRow: orderRowWithOtherId,
    });
    // Lock keys off orderRow.id, not the invoice id
    const lock = calls.find((c) => /pg_advisory_xact_lock/i.test(c.sql));
    expect(lock!.params).toEqual(["order:other-9"]);
  });
});