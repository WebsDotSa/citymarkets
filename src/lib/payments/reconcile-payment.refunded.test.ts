/**
 * Regression tests for PCP-144: stale `payment.notification` webhook
 * can regress `orders.payment_status` from 'refunded' back to a
 * stale value (e.g. 'paid', 'pending').
 *
 * Background:
 *   The mirror SQL inside `reconcilePayment` guards the `paid` and
 *   `failed` terminal states via CASE, but a 3rd state — `refunded`,
 *   set by the admin refund flow at
 *   `src/app/api/admin/orders/[id]/refund/route.ts` — was missing
 *   from the guard. A late `payment.notification` callback arriving
 *   after the admin had already moved the order to `refunded` hit
 *   the `ELSE $1` branch of the CASE and overwrote the terminal
 *   `refunded` value with whatever the gateway re-sent.
 *
 *   The same fix needs to apply to the `vendor_orders` mirror — the
 *   admin refund also flips every child's `payment_status` to
 *   `refunded`, and a stale callback that regresses the parent only
 *   would leave the children out of sync.
 *
 *   The fix adds `WHEN payment_status = 'refunded' THEN 'refunded'`
 *   to BOTH the orders and vendor_orders CASE expressions, ahead of
 *   the `ELSE $1` fallback.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PoolClient } from "pg";

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

const mockMarkRecovered = vi.fn(async () => ({ recovered_count: 0 }));
vi.mock("@/lib/orders/abandoned-carts", () => ({
  markAbandonedCartRecovered: mockMarkRecovered,
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
  const client = {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      return { rowCount: 1, rows: [] };
    }),
    release: vi.fn(),
  };
  return { client: client as unknown as PoolClient, calls };
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
  mockMarkRecovered.mockResolvedValue({ recovered_count: 0 });
});

describe("reconcilePayment — PCP-144: refunded guard", () => {
  it("orders CASE expression contains a 'refunded' terminal guard", async () => {
    const { client, calls } = makeMockClient();
    await reconcilePayment(client, {
      invoiceId: "inv-r1",
      gateway: "moyasar",
      eventType: "payment.notification",
      paymentDb: "paid",
      rawBody: {},
      orderRow: baseOrderRow,
    });
    const ordersUpdate = calls.find((c) =>
      /^UPDATE orders\s+SET payment_status/i.test(c.sql.trim()),
    )!;
    expect(ordersUpdate).toBeDefined();
    // The CASE must explicitly protect the 'refunded' state from
    // being overwritten by a stale callback.
    expect(ordersUpdate.sql).toMatch(
      /WHEN payment_status = 'refunded'\s+THEN 'refunded'/i,
    );
  });

  it("vendor_orders CASE expression contains a 'refunded' terminal guard", async () => {
    const { client, calls } = makeMockClient();
    await reconcilePayment(client, {
      invoiceId: "inv-r2",
      gateway: "moyasar",
      eventType: "payment.notification",
      paymentDb: "paid",
      rawBody: {},
      orderRow: baseOrderRow,
    });
    const vendorUpdate = calls.find(
      (c) =>
        /^UPDATE vendor_orders/i.test(c.sql.trim()) &&
        c.sql.includes("payment_status"),
    )!;
    expect(vendorUpdate).toBeDefined();
    expect(vendorUpdate.sql).toMatch(
      /WHEN payment_status = 'refunded'\s+THEN 'refunded'/i,
    );
  });

  it("the 'refunded' guard appears BEFORE the ELSE fallback", async () => {
    const { client, calls } = makeMockClient();
    await reconcilePayment(client, {
      invoiceId: "inv-r3",
      gateway: "moyasar",
      eventType: "payment.notification",
      paymentDb: "pending",
      rawBody: {},
      orderRow: baseOrderRow,
    });
    const ordersUpdate = calls.find((c) =>
      /^UPDATE orders\s+SET payment_status/i.test(c.sql.trim()),
    )!;
    const refundedAt = ordersUpdate.sql.search(
      /WHEN payment_status = 'refunded'\s+THEN 'refunded'/i,
    );
    const elseAt = ordersUpdate.sql.search(/ELSE \$1/i);
    expect(refundedAt).toBeGreaterThan(-1);
    expect(elseAt).toBeGreaterThan(-1);
    expect(refundedAt).toBeLessThan(elseAt);
  });
});
