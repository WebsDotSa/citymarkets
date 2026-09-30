import { describe, expect, it } from "vitest";
import {
  vendorCreateSchema,
  vendorUpdateSchema,
  vendorPatchSchema,
} from "./vendor";
import { slugSchema } from "./primitives";

describe("slugSchema", () => {
  it("accepts Latin slugs", () => {
    expect(slugSchema.safeParse("foo-bar").success).toBe(true);
    expect(slugSchema.safeParse("a").success).toBe(true);
    expect(slugSchema.safeParse("abc-123").success).toBe(true);
  });

  it("accepts Arabic slugs", () => {
    expect(slugSchema.safeParse("متجر-فواكه").success).toBe(true);
    expect(slugSchema.safeParse("بقالة").success).toBe(true);
  });

  it("accepts mixed Latin+digits slugs", () => {
    expect(slugSchema.safeParse("store-42").success).toBe(true);
    expect(slugSchema.safeParse("2026-sale").success).toBe(true);
  });

  it("rejects empty string", () => {
    expect(slugSchema.safeParse("").success).toBe(false);
  });

  it("rejects leading dash", () => {
    expect(slugSchema.safeParse("-foo").success).toBe(false);
  });

  it("rejects trailing dash", () => {
    expect(slugSchema.safeParse("foo-").success).toBe(false);
  });

  it("rejects spaces, slash, percent, underscore", () => {
    expect(slugSchema.safeParse("foo bar").success).toBe(false);
    expect(slugSchema.safeParse("foo/bar").success).toBe(false);
    expect(slugSchema.safeParse("foo%bar").success).toBe(false);
    expect(slugSchema.safeParse("foo_bar").success).toBe(false);
  });

  it("rejects values longer than 80 chars", () => {
    expect(slugSchema.safeParse("a".repeat(81)).success).toBe(false);
    expect(slugSchema.safeParse("a".repeat(80)).success).toBe(true);
  });
});

describe("vendorCreateSchema", () => {
  const validBase = {
    name_ar: "متجر الفواكه",
    name_en: "Fruit Market",
    slug: "فواكه-ماركت",
    vendor_type: "food_beverage",
    contact_email: "owner@example.com",
    primary_color: "#009345",
  };

  it("accepts a minimal valid Arabic vendor", () => {
    const result = vendorCreateSchema.safeParse({
      ...validBase,
      contact_phone: "500000000",
      contact_whatsapp: "500000000",
    });
    // The phone regex `/^(\+966|966|0)?5\d{8}$/` accepts 5 + 8 digits
    expect(result.success).toBe(true);
  });

  it("accepts a valid vendor with full Saudi contact phone", () => {
    const result = vendorCreateSchema.safeParse({
      ...validBase,
      contact_phone: "0501234567",
      contact_whatsapp: "0501234567",
    });
    expect(result.success).toBe(true);
  });

  it("accepts a vendor with empty optional fields", () => {
    const result = vendorCreateSchema.safeParse({
      name_ar: "اسم",
      vendor_type: "food_beverage",
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing name_ar", () => {
    const result = vendorCreateSchema.safeParse({
      vendor_type: "food_beverage",
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty name_ar", () => {
    const result = vendorCreateSchema.safeParse({
      name_ar: "",
      vendor_type: "food_beverage",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid slug (leading dash)", () => {
    const result = vendorCreateSchema.safeParse({
      name_ar: "اسم",
      vendor_type: "food_beverage",
      slug: "-foo",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid contact_phone", () => {
    const result = vendorCreateSchema.safeParse({
      name_ar: "اسم",
      vendor_type: "food_beverage",
      contact_phone: "123-not-a-phone",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid contact_email", () => {
    const result = vendorCreateSchema.safeParse({
      name_ar: "اسم",
      vendor_type: "food_beverage",
      contact_email: "not-an-email",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid vendor_type", () => {
    const result = vendorCreateSchema.safeParse({
      name_ar: "اسم",
      vendor_type: "made_up_type",
    });
    expect(result.success).toBe(false);
  });

  it("accepts Unicode category_slug", () => {
    const result = vendorCreateSchema.safeParse({
      name_ar: "اسم",
      vendor_type: "food_beverage",
      category_slug: "بقالة",
    });
    expect(result.success).toBe(true);
  });

  it("rejects category_slug with leading dash", () => {
    const result = vendorCreateSchema.safeParse({
      name_ar: "اسم",
      vendor_type: "food_beverage",
      category_slug: "-foo",
    });
    expect(result.success).toBe(false);
  });

  it("normalizes empty logo_url to null", () => {
    const result = vendorCreateSchema.safeParse({
      name_ar: "اسم",
      vendor_type: "food_beverage",
      logo_url: "",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.logo_url).toBeNull();
    }
  });
});

describe("vendorUpdateSchema", () => {
  it("is fully partial — accepts empty object", () => {
    expect(vendorUpdateSchema.safeParse({}).success).toBe(true);
  });

  it("accepts a single-field update", () => {
    expect(
      vendorUpdateSchema.safeParse({ name_ar: "اسم جديد" }).success,
    ).toBe(true);
  });

  it("accepts a Unicode slug update", () => {
    expect(
      vendorUpdateSchema.safeParse({ slug: "متجر-جديد" }).success,
    ).toBe(true);
  });

  it("rejects an invalid slug update", () => {
    expect(vendorUpdateSchema.safeParse({ slug: "-bad" }).success).toBe(false);
  });
});

describe("vendorPatchSchema", () => {
  it("accepts is_active toggle", () => {
    expect(
      vendorPatchSchema.safeParse({ is_active: false }).success,
    ).toBe(true);
  });

  it("accepts is_featured toggle", () => {
    expect(
      vendorPatchSchema.safeParse({ is_featured: true }).success,
    ).toBe(true);
  });

  it("accepts sort_order", () => {
    expect(
      vendorPatchSchema.safeParse({ sort_order: 42 }).success,
    ).toBe(true);
  });

  it("rejects empty object (no fields to update)", () => {
    expect(vendorPatchSchema.safeParse({}).success).toBe(false);
  });

  it("rejects unknown keys (strict mode)", () => {
    expect(
      vendorPatchSchema.safeParse({ name_ar: "foo" }).success,
    ).toBe(false);
    expect(
      vendorPatchSchema.safeParse({ slug: "foo" }).success,
    ).toBe(false);
  });

  it("rejects sort_order out of range", () => {
    expect(
      vendorPatchSchema.safeParse({ sort_order: 100001 }).success,
    ).toBe(false);
    expect(
      vendorPatchSchema.safeParse({ sort_order: -1 }).success,
    ).toBe(false);
  });
});