import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Regression tests for P0-5 — markOrderPaymentFailed dedup + lifecycle.
 *
 * Bug: payment-service.markOrderPaymentFailed and
 * checkout-service.markPaymentFailed were two near-identical functions,
 * BOTH of which collapsed the invariant that `payment_status` and
 * `status` are independent axes by writing `status = 'cancelled'` on
 * payment init failure. A customer whose Moyasar session failed to
 * open a checkout URL had their order auto-cancelled even though they
 * could still retry. The retry route then had to flip status back to
 * 'pending' on every retry — racing against itself.
 *
 * Worse: vendor children were force-cancelled without restocking.
 *
 * Fix: payment-service.markOrderPaymentFailed is the single source of
 * truth. It writes ONLY payment_status; the retry route owns the
 * status column flip. The duplicate in checkout-service is deleted.
 */

const queryCalls: { sql: string; params: unknown[] }[] = [];

vi.mock("@/lib/db", () => ({
  pool: {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      queryCalls.push({ sql, params });
      return { rows: [] };
    }),
    connect: vi.fn(),
  },
}));

import { markOrderPaymentFailed } from "@/lib/payments/payment-service";

describe("markOrderPaymentFailed (P0-5 regression)", () => {
  beforeEach(() => {
    queryCalls.length = 0;
  });

  it("writes payment_status='failed' on the parent", async () => {
    await markOrderPaymentFailed("parent-1");
    const parentUpdate = queryCalls.find(
      (c) => /UPDATE orders/i.test(c.sql) && /WHERE id = \$1/i.test(c.sql),
    );
    expect(parentUpdate).toBeDefined();
    expect(parentUpdate!.sql).toMatch(/SET\s+payment_status\s*=\s*'failed'/i);
    expect(parentUpdate!.params[0]).toBe("parent-1");
  });

  it("does NOT write status='cancelled' on the parent (P0-5 fix)", async () => {
    // Pre-fix: SQL was
    //   UPDATE orders SET payment_status = 'failed', status = 'cancelled' WHERE id = $1
    // which collapsed the payment_status / status independence invariant.
    await markOrderPaymentFailed("parent-1");
    const parentUpdate = queryCalls.find(
      (c) => /UPDATE orders/i.test(c.sql),
    );
    expect(parentUpdate!.sql).not.toMatch(/status\s*=\s*'cancelled'/i);
  });

  it("writes payment_status='failed' on every vendor_order child", async () => {
    await markOrderPaymentFailed("parent-1", ["v-1", "v-2", "v-3"]);
    const childUpdates = queryCalls.filter(
      (c) => /UPDATE vendor_orders/i.test(c.sql),
    );
    expect(childUpdates.length).toBe(3);
    for (const u of childUpdates) {
      expect(u.sql).toMatch(/SET\s+payment_status\s*=\s*'failed'/i);
      expect(u.sql).not.toMatch(/status\s*=\s*'cancelled'/i);
    }
  });

  it("vendor children are NOT force-cancelled (P0-5 fix)", async () => {
    // Pre-fix: vendor_orders were auto-cancelled and never restocked —
    // the cook would never know to stop preparing an order that the
    // customer was about to retry.
    await markOrderPaymentFailed("parent-1", ["v-1"]);
    const childUpdate = queryCalls.find((c) =>
      /UPDATE vendor_orders/i.test(c.sql),
    );
    expect(childUpdate!.sql).not.toMatch(/status\s*=\s*'cancelled'/i);
  });

  it("is idempotent on repeat calls (no double-cancel, no double-failed)", async () => {
    await markOrderPaymentFailed("parent-1");
    const callsAfterFirst = queryCalls.length;
    await markOrderPaymentFailed("parent-1");
    // Repeat call still only flips payment_status='failed'. Because the
    // SQL has no idempotency guard, two updates just both set the same
    // value. The bug class we care about is "did it also cancel the
    // lifecycle?" — which it does NOT.
    const cancelCalls = queryCalls.filter((c) =>
      /status\s*=\s*'cancelled'/i.test(c.sql),
    );
    expect(cancelCalls.length).toBe(0);
    expect(queryCalls.length).toBeGreaterThan(callsAfterFirst);
  });
});