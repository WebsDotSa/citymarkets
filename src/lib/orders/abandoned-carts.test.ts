import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock pool and logger BEFORE importing the helper so vi.mock takes
// effect when the module evaluates.
vi.mock("@/lib/db", () => ({
  pool: { query: vi.fn() },
}));
vi.mock("@/lib/logger", () => ({
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
}));

import { pool } from "@/lib/db";
import {
  snapshotAbandonedCartFromOrder,
  markAbandonedCartRecovered,
  findAbandonedSnapshotByIntentOrder,
} from "./abandoned-carts";

const baseSnapshotInput = {
  user_id: "user-1",
  guest_session_id: null,
  guest_name: "أحمد",
  guest_phone: "0501234567",
  intent_order_id: "order-1",
  items: [
    {
      product_id: "p-1",
      name_ar: "تمر",
      quantity: 2,
      unit_price: 10,
      image_url: null,
      vendor_id: null,
    },
  ],
  subtotal: 20,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("snapshotAbandonedCartFromOrder", () => {
  it("returns early when items are empty (nothing to snapshot)", async () => {
    await snapshotAbandonedCartFromOrder({
      ...baseSnapshotInput,
      items: [],
    });
    expect(pool.query).not.toHaveBeenCalled();
  });

  it("inserts a row with the right shape", async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ id: "x" }], rowCount: 1 } as never);

    await snapshotAbandonedCartFromOrder(baseSnapshotInput);

    expect(pool.query).toHaveBeenCalledTimes(1);
    const [sql, params] = vi.mocked(pool.query).mock.calls[0];
    expect(sql).toMatch(/INSERT INTO abandoned_carts/);
    expect(sql).toMatch(/ON CONFLICT \(intent_order_id\) DO NOTHING/);
    expect(sql).toMatch(/status[\s\S]*'abandoned'/);
    expect(params?.[0]).toBe("user-1");
    expect(params?.[1]).toBeNull();
    expect(params?.[2]).toBe("أحمد");
    expect(params?.[3]).toBe("0501234567");
    expect(params?.[4]).toBe(2); // items_count = 2 (qty 2)
    expect(params?.[5]).toBe(20);
    expect(params?.[7]).toBe("order-1");
  });

  it("swallows DB errors and logs (no throw to caller)", async () => {
    vi.mocked(pool.query).mockRejectedValueOnce(new Error("db_down") as never);

    await expect(
      snapshotAbandonedCartFromOrder(baseSnapshotInput),
    ).resolves.toBeUndefined();
  });

  it("clamps negative subtotal to zero", async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [], rowCount: 0 } as never);

    await snapshotAbandonedCartFromOrder({
      ...baseSnapshotInput,
      subtotal: -5,
    });

    expect(vi.mocked(pool.query).mock.calls[0][1]?.[5]).toBe(0);
  });
});

describe("markAbandonedCartRecovered", () => {
  it("returns 0 when recovered_order_id is missing", async () => {
    const result = await markAbandonedCartRecovered("", {
      user_id: "user-1",
    });
    expect(result).toEqual({ recovered_count: 0, latest_intent_order_id: null });
    expect(pool.query).not.toHaveBeenCalled();
  });

  it("returns 0 when neither user_id nor guest_phone is supplied", async () => {
    const result = await markAbandonedCartRecovered("order-2", {
      user_id: null,
      guest_phone: null,
    });
    expect(result).toEqual({ recovered_count: 0, latest_intent_order_id: null });
    expect(pool.query).not.toHaveBeenCalled();
  });

  it("returns the count when the UPDATE hits matching rows", async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({
      rows: [
        { id: "snap-1", intent_order_id: "order-old-1" },
        { id: "snap-2", intent_order_id: "order-old-2" },
      ],
      rowCount: 2,
    } as never);

    const result = await markAbandonedCartRecovered("order-new", {
      user_id: "user-1",
      guest_phone: "0501234567",
    });

    expect(result.recovered_count).toBe(2);
    expect(result.latest_intent_order_id).toBe("order-old-1");
    const [sql, params] = vi.mocked(pool.query).mock.calls[0];
    // SQL must:
    //   - set status='recovered' on the right order
    //   - skip the just-recovered order itself
    expect(sql).toMatch(/UPDATE abandoned_carts/);
    expect(sql).toMatch(/SET status = 'recovered'/);
    expect(sql).toMatch(/intent_order_id <> \$1/);
    expect(params?.[0]).toBe("order-new");
    expect(params?.[1]).toBe("user-1");
    expect(params?.[2]).toBe("0501234567");
  });

  it("swallows DB errors and returns 0", async () => {
    vi.mocked(pool.query).mockRejectedValueOnce(new Error("db_down") as never);

    const result = await markAbandonedCartRecovered("order-new", {
      user_id: "user-1",
    });
    expect(result.recovered_count).toBe(0);
  });
});

describe("findAbandonedSnapshotByIntentOrder", () => {
  it("returns the row when found", async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({
      rows: [{ id: "snap-1", status: "abandoned" }],
      rowCount: 1,
    } as never);

    const result = await findAbandonedSnapshotByIntentOrder("order-1");
    expect(result).toEqual({ id: "snap-1", status: "abandoned" });
  });

  it("returns null when no row exists", async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({
      rows: [],
      rowCount: 0,
    } as never);

    expect(await findAbandonedSnapshotByIntentOrder("order-1")).toBeNull();
  });

  it("returns null on DB failure instead of throwing", async () => {
    vi.mocked(pool.query).mockRejectedValueOnce(new Error("db_down") as never);

    expect(await findAbandonedSnapshotByIntentOrder("order-1")).toBeNull();
  });
});
