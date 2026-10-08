import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * Tests for the wishlist service (P2-4).
 *
 * Validates the dedup-before-insert path, the cap enforcement, and
 * the row hydration shape that powers the API response.
 */

const calls: { sql: string; params: unknown[] }[] = [];
// State stack: tests push() a sequence of responses (one per query
// call) so we can simulate "EXISTS returns nothing, then COUNT
// returns 5, then INSERT WITH JOIN returns hydrated". Without the
// stack, all three calls would see the same response.
type MockResponse = {
  rows: unknown[];
  rowCount?: number;
};
let responseStack: MockResponse[] = [];

vi.mock("@/lib/db", () => ({
  query: vi.fn(async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    if (responseStack.length > 0) {
      return responseStack.shift()!;
    }
    return { rows: [], rowCount: 0 };
  }),
}));

import {
  addToWishlist,
  clearWishlist,
  getWishlistMembership,
  isInWishlist,
  listWishlist,
  MAX_WISHLIST_SIZE,
  removeFromWishlist,
} from "./wishlist-service";

beforeEach(() => {
  calls.length = 0;
  responseStack = [];
});

const hydratedRow = (overrides: Partial<Record<string, unknown>> = {}) => ({
  product_id: "p-1",
  added_at: "2026-09-29T12:00:00.000Z",
  id: "p-1",
  name: "Product",
  name_ar: "المنتج",
  slug: "product",
  price: 10,
  discount_price: null,
  image_url: null,
  vendor_id: "v-1",
  vendor_name: "Vendor",
  vendor_slug: "vendor",
  is_active: true,
  stock_qty: 5,
  ...overrides,
});

describe("listWishlist", () => {
  it("filters by user_id and orders by added_at DESC", async () => {
    responseStack = [{ rows: [hydratedRow()], rowCount: 1 }];
    const items = await listWishlist("u-1");
    expect(items).toHaveLength(1);
    expect(items[0]?.product.id).toBe("p-1");
    expect(items[0]?.product.price).toBe(10);
    expect(calls[0]?.sql).toMatch(/w\.user_id = \$1::uuid/);
    expect(calls[0]?.sql).toMatch(/ORDER BY w\.added_at DESC/);
  });

  it("serialises added_at as a string", async () => {
    responseStack = [{ rows: [hydratedRow({ added_at: "2026-09-29T12:00:00.000Z" })], rowCount: 1 }];
    const items = await listWishlist("u-1");
    expect(items[0]?.added_at).toBe("2026-09-29T12:00:00.000Z");
  });

  /**
   * REGRESSION (2026-10-08, customer-journey-e2e): the
   * `WISHLIST_PRODUCT_FIELDS` SELECT used to reference `p.slug` on the
   * `products_unified` view, but that view has no `slug` column — the
   * live DB rejected every wishlist list/add with
   *   "column p.slug does not exist"
   * The fix sources the public slug from `p.sku` (also nullable on the
   * view), exposed as `slug` to keep the WishlistProduct contract
   * intact. The `slug` type is `string | null` because `sku` is
   * nullable in the view.
   */
  it("SELECTs the slug from products_unified.sku (regression: view has no slug column)", async () => {
    responseStack = [{ rows: [hydratedRow()], rowCount: 1 }];
    await listWishlist("u-1");
    const sql = calls[0]?.sql ?? "";
    // The fix: do NOT reference p.slug (column does not exist on the view)
    expect(sql).not.toMatch(/\bp\.slug\b/);
    // The fix: pull from p.sku and alias as `slug` so the API contract stays.
    expect(sql).toMatch(/p\.sku\s+AS\s+slug/i);
  });
});

describe("addToWishlist", () => {
  it("returns already_present when the product is already in the list", async () => {
    // EXISTS hit (one query, returns the row)
    responseStack = [{ rows: [{ product_id: "p-1" }], rowCount: 1 }];
    const result = await addToWishlist("u-1", "p-1");
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("already_present");
  });

  it("returns full when the user has hit the cap", async () => {
    // EXISTS returns nothing, COUNT returns at-cap
    responseStack = [
      { rows: [], rowCount: 0 },
      { rows: [{ c: MAX_WISHLIST_SIZE }], rowCount: 1 },
    ];
    const result = await addToWishlist("u-1", "p-1");
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("full");
  });

  it("inserts via ON CONFLICT DO NOTHING and returns hydrated item", async () => {
    // EXISTS empty, COUNT 5, INSERT WITH JOIN returns the row
    responseStack = [
      { rows: [], rowCount: 0 },
      { rows: [{ c: 5 }], rowCount: 1 },
      { rows: [hydratedRow({ product_id: "p-2", id: "p-2", price: 25, discount_price: 20 })], rowCount: 1 },
    ];
    const result = await addToWishlist("u-1", "p-2");
    expect(result.ok).toBe(true);
    expect(result.item?.product.price).toBe(25);
    expect(result.item?.product.discount_price).toBe(20);
    const insertCall = calls.find((c) => /WITH inserted/i.test(c.sql));
    expect(insertCall).toBeDefined();
    expect(insertCall!.sql).toMatch(/ON CONFLICT \(user_id, product_id\) DO NOTHING/i);
  });

  /**
   * REGRESSION (2026-10-08, customer-journey-e2e): the CTE+JOIN query
   * in addToWishlist used to splice `WISHLIST_JOIN` directly into a
   * SELECT that already started with `FROM inserted i`, producing
   * `FROM inserted i FROM wishlist_items w JOIN products_unified p ...`
   * which PostgreSQL rejects with "syntax error at or near FROM". The
   * fix uses a parallel `WISHLIST_INSERTED_JOIN` clause that re-anchors
   * the JOIN on the CTE alias `i` instead of starting a new FROM.
   */
  it("does NOT emit two FROM clauses in the CTE+JOIN (regression: list-join reused in CTE context)", async () => {
    responseStack = [
      { rows: [], rowCount: 0 },
      { rows: [{ c: 5 }], rowCount: 1 },
      { rows: [hydratedRow({ product_id: "p-2", id: "p-2" })], rowCount: 1 },
    ];
    await addToWishlist("u-1", "p-2");
    const insertCall = calls.find((c) => /WITH inserted/i.test(c.sql));
    expect(insertCall).toBeDefined();
    // The fix: a single FROM clause (anchored on `inserted i`) followed
    // by JOINs. The old code had a second FROM here.
    const fromCount = (insertCall!.sql.match(/\bFROM\b/gi) ?? []).length;
    expect(fromCount).toBe(1);
    // And the fix JOINs the CTE alias, not wishlist_items w.
    expect(insertCall!.sql).toMatch(/FROM inserted i/i);
    expect(insertCall!.sql).toMatch(/JOIN products_unified p ON p\.id = i\.product_id/);
  });

  it("returns already_present when ON CONFLICT raced a concurrent insert", async () => {
    // EXISTS empty, COUNT 5, INSERT WITH JOIN returns 0 rows (conflict)
    responseStack = [
      { rows: [], rowCount: 0 },
      { rows: [{ c: 5 }], rowCount: 1 },
      { rows: [], rowCount: 0 },
    ];
    const result = await addToWishlist("u-1", "p-3");
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("already_present");
  });
});

describe("removeFromWishlist", () => {
  it("scopes the DELETE to the user's own rows", async () => {
    responseStack = [{ rows: [], rowCount: 1 }];
    const removed = await removeFromWishlist("u-1", "p-1");
    expect(typeof removed).toBe("number");
    expect(calls[0]?.sql).toMatch(/user_id = \$1::uuid/);
    expect(calls[0]?.sql).toMatch(/product_id = \$2::uuid/);
    expect(calls[0]?.params).toEqual(["u-1", "p-1"]);
  });
});

describe("isInWishlist", () => {
  it("returns true when the row exists", async () => {
    responseStack = [{ rows: [{ product_id: "p-1" }], rowCount: 1 }];
    expect(await isInWishlist("u-1", "p-1")).toBe(true);
  });

  it("returns false when no row exists", async () => {
    responseStack = [{ rows: [], rowCount: 0 }];
    expect(await isInWishlist("u-1", "p-1")).toBe(false);
  });
});

describe("clearWishlist", () => {
  it("deletes all rows for the user", async () => {
    responseStack = [{ rows: [], rowCount: 3 }];
    const removed = await clearWishlist("u-1");
    expect(typeof removed).toBe("number");
    expect(calls[0]?.sql).toMatch(/DELETE FROM wishlist_items/i);
    expect(calls[0]?.params).toEqual(["u-1"]);
  });
});

describe("getWishlistMembership", () => {
  it("returns empty set for empty input without hitting the DB", async () => {
    const set = await getWishlistMembership("u-1", []);
    expect(set.size).toBe(0);
    expect(calls).toHaveLength(0);
  });

  it("uses ANY($2::uuid[]) for batch lookup", async () => {
    responseStack = [
      { rows: [{ product_id: "p-1" }, { product_id: "p-3" }], rowCount: 2 },
    ];
    const set = await getWishlistMembership("u-1", ["p-1", "p-2", "p-3"]);
    expect(set.size).toBe(2);
    expect(set.has("p-1")).toBe(true);
    expect(set.has("p-2")).toBe(false);
    expect(set.has("p-3")).toBe(true);
    expect(calls[0]?.sql).toMatch(/ANY\(\$2::uuid\[\]\)/);
  });
});
