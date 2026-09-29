import { describe, it, expect } from "vitest";
import { mapProductRow } from "./product-search";

describe("mapProductRow", () => {
  it("maps all standard string/number fields with sensible defaults", () => {
    const row: Record<string, unknown> = {
      id: 42,
      category_id: 3,
      name_ar: "تفاح",
      name_en: "Apple",
      barcode: "ABC-123",
      description: "Fresh",
      image_url: "https://img/p.jpg",
      images: ["https://img/p1.jpg", "https://img/p2.jpg"],
      price: 9.99,
      discount_price: 7.5,
      stock_qty: 12,
      unit: "kg",
      is_featured: 1,
      is_active: true,
      category_name: "Fruits",
      category_slug: "fruits",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-02T00:00:00Z",
    };
    const out = mapProductRow(row);
    expect(out).toEqual({
      id: "42",
      category_id: "3",
      name_ar: "تفاح",
      name_en: "Apple",
      barcode: "ABC-123",
      description: "Fresh",
      image_url: "https://img/p.jpg",
      images: ["https://img/p1.jpg", "https://img/p2.jpg"],
      price: 9.99,
      discount_price: 7.5,
      stock_qty: 12,
      unit: "kg",
      is_featured: true,
      is_active: true,
      category_name: "Fruits",
      category_slug: "fruits",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-02T00:00:00Z",
    });
  });

  it("coerces falsy optional strings to null", () => {
    const out = mapProductRow({
      id: 1,
      category_id: 1,
      name_ar: "x",
      name_en: null,
      barcode: "",
      description: undefined,
      image_url: "",
      price: 0,
      discount_price: null,
      stock_qty: 0,
      unit: "",
      is_featured: 0,
      is_active: 0,
      created_at: "",
      updated_at: "",
      images: null,
    });
    expect(out.name_en).toBeNull();
    expect(out.barcode).toBeNull();
    expect(out.description).toBeNull();
    expect(out.image_url).toBeNull();
    expect(out.discount_price).toBeNull();
    expect(out.images).toEqual([]);
    expect(out.unit).toBe("piece"); // default fallback
    expect(out.is_featured).toBe(false);
    expect(out.is_active).toBe(false);
  });

  it("defaults price/stock_qty to 0 when unparseable", () => {
    const out = mapProductRow({
      id: 1,
      category_id: 1,
      name_ar: "x",
      price: "not-a-number",
      stock_qty: "not-an-int",
      images: null,
      created_at: "",
      updated_at: "",
    });
    expect(out.price).toBe(0);
    expect(out.stock_qty).toBe(0);
  });

  it("parses numeric strings into numbers", () => {
    const out = mapProductRow({
      id: 1,
      category_id: 1,
      name_ar: "x",
      price: "10.5",
      discount_price: "9.25",
      stock_qty: "5",
      images: null,
      created_at: "",
      updated_at: "",
    });
    expect(out.price).toBe(10.5);
    expect(out.discount_price).toBe(9.25);
    expect(out.stock_qty).toBe(5);
  });

  it("omits category fields when absent", () => {
    const out = mapProductRow({
      id: 1,
      category_id: 1,
      name_ar: "x",
      price: 1,
      stock_qty: 0,
      images: null,
      created_at: "",
      updated_at: "",
    });
    expect(out.category_name).toBeUndefined();
    expect(out.category_slug).toBeUndefined();
  });
});
