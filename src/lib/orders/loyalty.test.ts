import { describe, it, expect, vi } from "vitest";
import type { PoolClient } from "pg";

import {
  DEFAULT_LOYALTY_SETTINGS,
  awardPointsForOrder,
  computeEarnPoints,
  releaseRedeemHoldForOrder,
  resolveRedeemForOrder,
  type LoyaltySettings,
} from "./loyalty";

// Minimal pg.PoolClient shape — only `query` is used by the helpers.
function makeMockClient() {
  return { query: vi.fn() } as unknown as {
    query: ReturnType<typeof vi.fn>;
  };
}

const settings: LoyaltySettings = { ...DEFAULT_LOYALTY_SETTINGS };

describe("computeEarnPoints", () => {
  it("returns 0 below the marketing rate (9.99 SAR → 0 points)", () => {
    expect(computeEarnPoints(9.99, settings)).toBe(0);
  });

  it("returns 1 for the 10-SAR threshold", () => {
    expect(computeEarnPoints(10, settings)).toBe(1);
  });

  it("returns 10 for a 100-SAR order", () => {
    expect(computeEarnPoints(100, settings)).toBe(10);
  });

  it("rounds down on fractional subtotals (109 SAR → 10, not 11)", () => {
    // 109 * 0.1 = 10.9 → floor = 10
    expect(computeEarnPoints(109, settings)).toBe(10);
  });

  it("returns 0 for non-positive subtotals", () => {
    expect(computeEarnPoints(0, settings)).toBe(0);
    expect(computeEarnPoints(-50, settings)).toBe(0);
  });

  it("returns 0 when loyalty is disabled", () => {
    expect(
      computeEarnPoints(100, { ...settings, enabled: false }),
    ).toBe(0);
  });

  it("honours an admin-tuned rate (2 SAR = 1 point)", () => {
    expect(
      computeEarnPoints(50, { ...settings, earn_points_per_sar: 0.5 }),
    ).toBe(25);
  });
});

describe("awardPointsForOrder", () => {
  it("writes earn row, credits balance, and stamps orders.points_earned on fresh insert", async () => {
    const client = makeMockClient();
    // 1) INSERT … RETURNING id (one row → fresh)
    client.query.mockResolvedValueOnce({
      rows: [{ id: "tx-1" }],
      rowCount: 1,
    });
    // 2) UPDATE loyalty_points (UPSERT)
    client.query.mockResolvedValueOnce({ rows: [], rowCount: 1 });
    // 3) UPDATE orders SET points_earned
    client.query.mockResolvedValueOnce({ rows: [], rowCount: 1 });

    const out = await awardPointsForOrder(client as never, {
      orderId: "order-1",
      userId: "user-1",
      catalogSubtotal: 100,
      settings,
    });

    expect(out).toEqual({ awarded: 10, duplicate: false });
    expect(client.query).toHaveBeenCalledTimes(3);

    // Verify the earn-row insert matches the spec.
    expect(client.query.mock.calls[0][0]).toMatch(
      /ON CONFLICT \(ref_order_id, type\) DO NOTHING/i,
    );
    expect(client.query.mock.calls[0][1]).toEqual([
      "user-1",
      10,
      "order-1",
    ]);

    // Verify the loyalty_points UPSERT increments by 10.
    const loyaltyUpsert = client.query.mock.calls[1][1] as unknown[];
    expect(loyaltyUpsert).toEqual(["user-1", 10]);

    // Verify the orders.points_earned stamp.
    const orderStamp = client.query.mock.calls[2][1] as unknown[];
    expect(orderStamp).toEqual([10, "order-1"]);
  });

  it("returns duplicate=true and skips balance update on retry", async () => {
    const client = makeMockClient();
    // INSERT … RETURNING id returns 0 rows → ON CONFLICT fired
    client.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const out = await awardPointsForOrder(client as never, {
      orderId: "order-2",
      userId: "user-2",
      catalogSubtotal: 100,
      settings,
    });

    expect(out).toEqual({ awarded: 0, duplicate: true });
    // Only the INSERT runs; no loyalty_points or orders update.
    expect(client.query).toHaveBeenCalledTimes(1);
  });

  it("returns 0 awarded when subtotal is below the rate threshold", async () => {
    const client = makeMockClient();
    const out = await awardPointsForOrder(client as never, {
      orderId: "order-3",
      userId: "user-3",
      catalogSubtotal: 5,
      settings,
    });
    expect(out).toEqual({ awarded: 0, duplicate: false });
    // No SQL emitted — short-circuit before INSERT.
    expect(client.query).not.toHaveBeenCalled();
  });

  it("returns 0 when loyalty is disabled", async () => {
    const client = makeMockClient();
    const out = await awardPointsForOrder(client as never, {
      orderId: "order-4",
      userId: "user-4",
      catalogSubtotal: 100,
      settings: { ...settings, enabled: false },
    });
    expect(out).toEqual({ awarded: 0, duplicate: false });
    expect(client.query).not.toHaveBeenCalled();
  });
});

describe("resolveRedeemForOrder", () => {
  it("writes redeem row and debits balance on fresh insert", async () => {
    const client = makeMockClient();
    client.query.mockResolvedValueOnce({
      rows: [{ id: "tx-r1" }],
      rowCount: 1,
    });
    client.query.mockResolvedValueOnce({ rows: [], rowCount: 1 });

    const out = await resolveRedeemForOrder(client as never, {
      orderId: "order-r1",
      userId: "user-r1",
      pointsRedeemed: 200,
    });

    expect(out).toEqual({ debited: 200, duplicate: false });
    expect(client.query).toHaveBeenCalledTimes(2);

    const redeemInsert = client.query.mock.calls[0][1] as unknown[];
    // Negative value (it's a debit, so the ledger row carries -200).
    expect(redeemInsert).toEqual(["user-r1", -200, "order-r1"]);

    const debitUpdate = client.query.mock.calls[1][1] as unknown[];
    expect(debitUpdate).toEqual([200, "user-r1"]);
  });

  it("returns duplicate=true on retry", async () => {
    const client = makeMockClient();
    client.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const out = await resolveRedeemForOrder(client as never, {
      orderId: "order-r2",
      userId: "user-r2",
      pointsRedeemed: 100,
    });

    expect(out).toEqual({ debited: 0, duplicate: true });
    expect(client.query).toHaveBeenCalledTimes(1);
  });

  it("is a no-op when pointsRedeemed is zero", async () => {
    const client = makeMockClient();
    const out = await resolveRedeemForOrder(client as never, {
      orderId: "order-r3",
      userId: "user-r3",
      pointsRedeemed: 0,
    });
    expect(out).toEqual({ debited: 0, duplicate: false });
    expect(client.query).not.toHaveBeenCalled();
  });

  // PCP-145: loyalty double-spend via missing rowCount check.
  //
  // The original `resolveRedeemForOrder` does:
  //   1) INSERT ... ON CONFLICT DO NOTHING → returns the new id
  //   2) UPDATE loyalty_points SET balance = balance - $1 WHERE balance >= $1
  // and never inspects the UPDATE's rowCount. If a concurrent order
  // drained the user's balance between the `pending_redeem` hold and
  // this resolve, the UPDATE silently matches 0 rows, no exception
  // fires, and the function returns `{ debited: points, duplicate:
  // false }`. The orphan `redeem` row stays in the ledger, the
  // customer's `loyalty_points.balance` is not debited, and the next
  // order can re-spend the same points — i.e. effective double-spend
  // against the marketplace.
  //
  // The fix: the helper must observe the UPDATE's rowCount. When 0
  // rows match (the balance is short), the function MUST raise so the
  // surrounding transaction rolls back, removing the orphan `redeem`
  // ledger row and forcing the caller to surface the failure to ops.
  it("PCP-145: throws when UPDATE matches 0 rows (balance drained concurrently)", async () => {
    const client = makeMockClient();
    // Step 1: INSERT lands the redeem row (returns a new id).
    client.query.mockResolvedValueOnce({
      rows: [{ id: "tx-r-orphan" }],
      rowCount: 1,
    });
    // Step 2: UPDATE matches 0 rows — balance is short.
    client.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    await expect(
      resolveRedeemForOrder(client as never, {
        orderId: "order-orphan",
        userId: "user-orphan",
        pointsRedeemed: 500,
      }),
    ).rejects.toThrow(/balance/i);

    // Both queries must have run; the throw must come AFTER the UPDATE
    // (not short-circuit on the INSERT) so the caller can rely on
    // rollback semantics to clean up the orphan row.
    expect(client.query).toHaveBeenCalledTimes(2);
  });
});

describe("releaseRedeemHoldForOrder (P1-7)", () => {
  it("DELETEs the pending_redeem row and reports released=true", async () => {
    const client = makeMockClient();
    client.query.mockResolvedValueOnce({ rows: [{ id: "lt-1" }], rowCount: 1 });
    const out = await releaseRedeemHoldForOrder(client as unknown as PoolClient, {
      orderId: "order-rh1",
    });
    expect(out).toEqual({ released: true });
    expect(client.query).toHaveBeenCalledOnce();
    const [sql, params] = client.query.mock.calls[0];
    expect(sql).toMatch(/DELETE FROM loyalty_transactions/);
    expect(sql).toMatch(/type = 'pending_redeem'/);
    expect(params).toEqual(["order-rh1"]);
  });

  it("reports released=false when nothing matched (idempotent)", async () => {
    const client = makeMockClient();
    client.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const out = await releaseRedeemHoldForOrder(client as unknown as PoolClient, {
      orderId: "order-rh2",
    });
    expect(out).toEqual({ released: false });
  });
});
