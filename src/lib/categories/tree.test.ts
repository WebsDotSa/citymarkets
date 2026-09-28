import { describe, it, expect } from "vitest";
import {
  buildCategoryTree,
  findCategory,
  getAncestors,
  getChildren,
  getSiblings,
} from "./tree";
import type { CategoryRow } from "@/lib/types";

function row(over: Partial<CategoryRow> & Pick<CategoryRow, "id" | "name_ar" | "slug" | "parent_id">): CategoryRow {
  return {
    icon_url: null,
    sort_order: 0,
    product_count: 0,
    ...over,
  };
}

describe("buildCategoryTree", () => {
  it("groups roots with their children and computes descendant counts", () => {
    const rows: CategoryRow[] = [
      row({ id: 1, name_ar: "ألبان", slug: "dairy", parent_id: null, sort_order: 1, product_count: 5 }),
      row({ id: 2, name_ar: "حليب", slug: "milk", parent_id: 1, sort_order: 1, product_count: 30 }),
      row({ id: 3, name_ar: "جبن", slug: "cheese", parent_id: 1, sort_order: 2, product_count: 15 }),
      row({ id: 4, name_ar: "لبنة", slug: "labneh", parent_id: 3, sort_order: 1, product_count: 6 }),
      row({ id: 5, name_ar: "مقاضي", slug: "pantry", parent_id: null, sort_order: 2, product_count: 20 }),
      row({ id: 6, name_ar: "أرز", slug: "rice", parent_id: 5, sort_order: 1, product_count: 50 }),
    ];
    const tree = buildCategoryTree(rows);
    expect(tree).toHaveLength(2);
    expect(tree[0].slug).toBe("dairy");
    // dairy has 5 own + 30 (milk) + (15 + 6 for cheese subtree) = 56
    expect(tree[0].descendantCount).toBe(56);
    expect(tree[0].children.map((c) => c.slug)).toEqual(["milk", "cheese"]);
    expect(tree[0].children[1].children[0].slug).toBe("labneh");
    expect(tree[0].children[1].descendantCount).toBe(21);
    // pantry = 20 + 50
    expect(tree[1].descendantCount).toBe(70);
  });

  it("skips inactive categories", () => {
    const rows: CategoryRow[] = [
      row({ id: 1, name_ar: "ألبان", slug: "dairy", parent_id: null, is_active: false }),
      row({ id: 2, name_ar: "مقاضي", slug: "pantry", parent_id: null, is_active: true }),
    ];
    expect(buildCategoryTree(rows)).toHaveLength(1);
  });

  it("sorts by sort_order then name_ar", () => {
    const rows: CategoryRow[] = [
      row({ id: 1, name_ar: "ب", slug: "b", parent_id: null, sort_order: 1 }),
      row({ id: 2, name_ar: "أ", slug: "a", parent_id: null, sort_order: 1 }),
      row({ id: 3, name_ar: "ج", slug: "c", parent_id: null, sort_order: 2 }),
    ];
    expect(buildCategoryTree(rows).map((n) => n.slug)).toEqual(["a", "b", "c"]);
  });
});

describe("findCategory", () => {
  const rows: CategoryRow[] = [
    row({ id: 1, name_ar: "ألبان", slug: "dairy", parent_id: null }),
    row({ id: 2, name_ar: "حليب", slug: "milk", parent_id: 1 }),
  ];
  it("matches exact slug", () => {
    expect(findCategory(rows, "milk")?.id).toBe(2);
  });
  it("decodes URL-encoded Arabic slugs", () => {
    expect(findCategory(rows, encodeURIComponent("dairy"))?.id).toBe(1);
  });
  it("returns null on miss", () => {
    expect(findCategory(rows, "nope")).toBeNull();
    expect(findCategory(rows, "")).toBeNull();
  });
});

describe("getAncestors", () => {
  it("returns root → self chain", () => {
    const rows: CategoryRow[] = [
      row({ id: 1, name_ar: "ألبان", slug: "dairy", parent_id: null }),
      row({ id: 2, name_ar: "جبن", slug: "cheese", parent_id: 1 }),
      row({ id: 3, name_ar: "لبنة", slug: "labneh", parent_id: 2 }),
    ];
    const chain = getAncestors(rows, "labneh");
    expect(chain.map((c) => c.slug)).toEqual(["dairy", "cheese", "labneh"]);
  });
  it("returns just the root for top-level", () => {
    const rows: CategoryRow[] = [
      row({ id: 1, name_ar: "ألبان", slug: "dairy", parent_id: null }),
    ];
    expect(getAncestors(rows, "dairy").map((c) => c.slug)).toEqual(["dairy"]);
  });
  it("returns [] for missing slug", () => {
    expect(getAncestors([], "x")).toEqual([]);
  });
});

describe("getSiblings", () => {
  it("returns other roots for top-level slug", () => {
    const rows: CategoryRow[] = [
      row({ id: 1, name_ar: "ألبان", slug: "dairy", parent_id: null }),
      row({ id: 2, name_ar: "مقاضي", slug: "pantry", parent_id: null }),
      row({ id: 3, name_ar: "لحوم", slug: "meat", parent_id: null }),
    ];
    expect(getSiblings(rows, "dairy").map((c) => c.slug).sort()).toEqual(["meat", "pantry"]);
  });
  it("returns other children of same parent for nested slug", () => {
    const rows: CategoryRow[] = [
      row({ id: 1, name_ar: "ألبان", slug: "dairy", parent_id: null }),
      row({ id: 2, name_ar: "حليب", slug: "milk", parent_id: 1 }),
      row({ id: 3, name_ar: "جبن", slug: "cheese", parent_id: 1 }),
      row({ id: 4, name_ar: "زبدة", slug: "butter", parent_id: 1 }),
    ];
    expect(getSiblings(rows, "milk").map((c) => c.slug).sort()).toEqual(["butter", "cheese"]);
  });
});

describe("getChildren", () => {
  it("returns direct children only, sorted by sort_order", () => {
    const rows: CategoryRow[] = [
      row({ id: 1, name_ar: "ألبان", slug: "dairy", parent_id: null }),
      row({ id: 2, name_ar: "حليب", slug: "milk", parent_id: 1, sort_order: 2 }),
      row({ id: 3, name_ar: "جبن", slug: "cheese", parent_id: 1, sort_order: 1 }),
      row({ id: 4, name_ar: "لبنة", slug: "labneh", parent_id: 3 }),
    ];
    expect(getChildren(rows, "dairy").map((c) => c.slug)).toEqual(["cheese", "milk"]);
  });
});
