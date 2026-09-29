import { describe, it, expect, vi } from "vitest";
import { resolveItems } from "./resolve-items";

// Build a fake pg.Client that returns canned rows based on which SQL is run.
// resolveItems runs 3 distinct queries per vendor group + 1 catalog query.
interface FakeQuery {
  sql: string;
  params: unknown[];
}
class FakeClient {
  log: FakeQuery[] = [];
  catalogResponse: unknown[] = [];
  vendorResponse: unknown = null;
  vendorProductResponse: unknown[] = [];

  async query(sql: string, params: unknown[] = []) {
    this.log.push({ sql, params });
    if (/FROM products_unified/i.test(sql)) {
      return { rows: this.catalogResponse };
    }
    if (/FROM vendors(\s|$)/i.test(sql)) {
      return { rows: this.vendorResponse ? [this.vendorResponse] : [] };
    }
    if (/FROM vendor_products/i.test(sql)) {
      return { rows: this.vendorProductResponse };
    }
    return { rows: [] };
  }
}

describe("resolveItems", () => {
  it("returns an empty resolution when there is nothing to resolve", async () => {
    const client = new FakeClient();
    const out = await resolveItems({
      catalog: [],
      vendorGroups: [],
      client,
    });
    expect(out).toEqual({ catalog: [], vendorGroups: [] });
    expect(client.log).toHaveLength(0);
  });

  it("resolves a single catalog item with stock and pricing from discount_price", async () => {
    const client = new FakeClient();
    client.catalogResponse = [
      {
        id: "p1",
        name_ar: "تفاح",
        price: "10.00",
        discount_price: "8.00",
        stock_qty: 100,
        track_stock: true,
        image_url: "https://img/p1.jpg",
        vendor_id: "00000000-0000-0000-0000-000000000001", // CITY_MARKETS_VENDOR_ID
      },
    ];
    const out = await resolveItems({
      catalog: [
        { items: [{ product_id: "p1", quantity: 3 }] },
      ],
      vendorGroups: [],
      client,
    });
    expect(out).toMatchObject({
      catalog: [
        {
          product_id: "p1",
          quantity: 3,
          unit_price: 8,
          name_ar: "تفاح",
          stock_qty: 100,
          track_stock: true,
          image_url: "https://img/p1.jpg",
          vendor_id: "00000000-0000-0000-0000-000000000001",
        },
      ],
      vendorGroups: [],
    });
  });

  it("falls back to price when discount_price is null", async () => {
    const client = new FakeClient();
    client.catalogResponse = [
      {
        id: "p1",
        name_ar: "X",
        price: "12.50",
        discount_price: null,
        stock_qty: 5,
        track_stock: true,
        image_url: null,
        vendor_id: "00000000-0000-0000-0000-000000000001",
      },
    ];
    const out = await resolveItems({
      catalog: [{ items: [{ product_id: "p1", quantity: 1 }] }],
      vendorGroups: [],
      client,
    });
    expect("unit_price" in (out as { catalog: { unit_price: number }[] }).catalog[0]).toBe(true);
    expect((out as { catalog: { unit_price: number }[] }).catalog[0].unit_price).toBe(12.5);
  });

  it("returns product_not_found when a catalog id is missing", async () => {
    const client = new FakeClient();
    client.catalogResponse = []; // nothing
    const out = await resolveItems({
      catalog: [{ items: [{ product_id: "missing", quantity: 1 }] }],
      vendorGroups: [],
      client,
    });
    expect(out).toMatchObject({
      kind: "product_not_found",
      productId: "missing",
    });
  });

  it("returns ownership_mismatch when a vendor product sneaks into catalog bucket", async () => {
    const client = new FakeClient();
    client.catalogResponse = [
      {
        id: "vp1",
        name_ar: "Vendor Prod",
        price: "10",
        discount_price: null,
        stock_qty: 10,
        track_stock: true,
        image_url: null,
        vendor_id: "different-vendor-id",
      },
    ];
    const out = await resolveItems({
      catalog: [{ items: [{ product_id: "vp1", quantity: 1 }] }],
      vendorGroups: [],
      client,
    });
    expect(out).toMatchObject({ kind: "ownership_mismatch", productId: "vp1" });
  });

  it("returns stock_insufficient when catalog quantity exceeds stock", async () => {
    const client = new FakeClient();
    client.catalogResponse = [
      {
        id: "p1",
        name_ar: "X",
        price: "1",
        discount_price: null,
        stock_qty: 2,
        track_stock: true,
        image_url: null,
        vendor_id: "00000000-0000-0000-0000-000000000001",
      },
    ];
    const out = await resolveItems({
      catalog: [{ items: [{ product_id: "p1", quantity: 5 }] }],
      vendorGroups: [],
      client,
    });
    expect(out).toMatchObject({ kind: "stock_insufficient", productId: "p1" });
  });

  it("skips the stock check when track_stock is false", async () => {
    const client = new FakeClient();
    client.catalogResponse = [
      {
        id: "p1",
        name_ar: "NoTrack",
        price: "1",
        discount_price: null,
        stock_qty: 0,
        track_stock: false,
        image_url: null,
        vendor_id: "00000000-0000-0000-0000-000000000001",
      },
    ];
    const out = await resolveItems({
      catalog: [{ items: [{ product_id: "p1", quantity: 100 }] }],
      vendorGroups: [],
      client,
    });
    expect("kind" in out).toBe(false);
  });

  it("resolves a vendor group with active vendor and sufficient subtotal", async () => {
    const client = new FakeClient();
    client.vendorResponse = {
      id: "vendor-1",
      slug: "vendor-1",
      name_ar: "متجر ١",
      is_active: true,
      min_order_amount: "20",
    };
    client.vendorProductResponse = [
      {
        id: "vp1",
        name_ar: "Vendor Item",
        price: "10",
        discount_price: null,
        stock_quantity: 50,
        track_stock: true,
        image_urls: ["https://img/v1.jpg"],
        vendor_id: "vendor-1",
      },
    ];
    const out = await resolveItems({
      catalog: [],
      vendorGroups: [
        {
          vendor_id: "vendor-1",
          items: [{ product_id: "vp1", quantity: 3 }],
        },
      ],
      client,
    });
    expect(out).toMatchObject({
      vendorGroups: [
        {
          vendor_id: "vendor-1",
          vendor_slug: "vendor-1",
          vendor_name: "متجر ١",
          subtotal: 30,
          min_order_amount: 20,
        },
      ],
    });
    // delivery_fee_override is gone — every group pays the universal
    // distance-based fee. The field isn't read from the DB anymore, so
    // the resolved group MUST NOT carry it.
    const group = (out as unknown as { vendorGroups: Record<string, unknown>[] }).vendorGroups[0];
    expect(group).not.toHaveProperty("delivery_fee_override");
  });

  it("returns vendor_inactive when vendor is missing", async () => {
    const client = new FakeClient();
    client.vendorResponse = null;
    const out = await resolveItems({
      catalog: [],
      vendorGroups: [
        { vendor_id: "v1", items: [{ product_id: "p1", quantity: 1 }] },
      ],
      client,
    });
    expect(out).toMatchObject({ kind: "vendor_inactive", vendorId: "v1" });
  });

  it("returns vendor_inactive when vendor.is_active is false", async () => {
    const client = new FakeClient();
    client.vendorResponse = {
      id: "v1",
      slug: "v1",
      name_ar: "V",
      is_active: false,
      min_order_amount: null,
    };
    const out = await resolveItems({
      catalog: [],
      vendorGroups: [
        { vendor_id: "v1", items: [{ product_id: "p1", quantity: 1 }] },
      ],
      client,
    });
    expect(out).toMatchObject({ kind: "vendor_inactive", vendorId: "v1" });
  });

  it("returns ownership_mismatch when a vendor product is not owned by the claimed vendor", async () => {
    const client = new FakeClient();
    client.vendorResponse = {
      id: "v1",
      slug: "v1",
      name_ar: "V",
      is_active: true,
      min_order_amount: null,
    };
    client.vendorProductResponse = [
      {
        id: "vp1",
        name_ar: "X",
        price: "1",
        discount_price: null,
        stock_quantity: 10,
        track_stock: true,
        image_urls: null,
        vendor_id: "different-vendor",
      },
    ];
    const out = await resolveItems({
      catalog: [],
      vendorGroups: [
        { vendor_id: "v1", items: [{ product_id: "vp1", quantity: 1 }] },
      ],
      client,
    });
    expect(out).toMatchObject({
      kind: "ownership_mismatch",
      productId: "vp1",
      vendorId: "v1",
    });
  });

  it("returns stock_insufficient for vendor products when quantity exceeds stock", async () => {
    const client = new FakeClient();
    client.vendorResponse = {
      id: "v1",
      slug: "v1",
      name_ar: "V",
      is_active: true,
      min_order_amount: null,
    };
    client.vendorProductResponse = [
      {
        id: "vp1",
        name_ar: "X",
        price: "1",
        discount_price: null,
        stock_quantity: 2,
        track_stock: true,
        image_urls: null,
        vendor_id: "v1",
      },
    ];
    const out = await resolveItems({
      catalog: [],
      vendorGroups: [
        { vendor_id: "v1", items: [{ product_id: "vp1", quantity: 10 }] },
      ],
      client,
    });
    expect(out).toMatchObject({ kind: "stock_insufficient", productId: "vp1" });
  });

  it("returns vendor_min_order when subtotal is below the minimum", async () => {
    const client = new FakeClient();
    client.vendorResponse = {
      id: "v1",
      slug: "v1",
      name_ar: "V",
      is_active: true,
      min_order_amount: "100",
    };
    client.vendorProductResponse = [
      {
        id: "vp1",
        name_ar: "X",
        price: "1",
        discount_price: null,
        stock_quantity: 100,
        track_stock: true,
        image_urls: null,
        vendor_id: "v1",
      },
    ];
    const out = await resolveItems({
      catalog: [],
      vendorGroups: [
        { vendor_id: "v1", items: [{ product_id: "vp1", quantity: 5 }] },
      ],
      client,
    });
    expect(out).toMatchObject({
      kind: "vendor_min_order",
      vendorId: "v1",
      minOrder: 100,
      subtotal: 5,
    });
  });
});
