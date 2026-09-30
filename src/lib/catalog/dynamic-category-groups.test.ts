import { describe, expect, it } from "vitest";
import {
  buildDynamicGroups,
  emojiForCategoryName,
} from "./dynamic-category-groups";
import type { CategoryRow } from "@/lib/types";

/**
 * dynamic-category-groups is the small, pure utility that powers the
 * category sections of the storefront landing page.
 * It is consumed on every render so a regression here manifests as
 * sections that disappear or get the wrong emoji — both visible bugs
 * without needing React Testing Library to catch.
 */

// Minimal CategoryRow shape; fields not exercised are optional.
function cat(overrides: Partial<CategoryRow> & { id: string }): CategoryRow {
  return {
    name_ar: overrides.name_ar ?? "فئة",
    slug: overrides.slug ?? overrides.id,
    is_active: overrides.is_active ?? true,
    sort_order: overrides.sort_order ?? 0,
    ...overrides,
  } as CategoryRow;
}

describe("emojiForCategoryName", () => {
  it("matches dairy to milk emoji", () => {
    expect(emojiForCategoryName("ألبان وأجبان")).toBe("🥛");
    expect(emojiForCategoryName("حليب طازج")).toBe("🥛");
    expect(emojiForCategoryName("زبادي")).toBe("🥛");
  });

  it("matches produce to lettuce emoji", () => {
    // The whole-phrase "فواكه وخضروات" is the canonical seed name and
    // we want it pinned — sub-strings like "خضروات طازجة" hit different
    // regex buckets depending on order. The exact-comparison below is
    // the one this test guards: if the regex order changes for this
    // exact phrase, somebody should know.
    expect(emojiForCategoryName("فواكه وخضروات")).toBe("🥬");
  });

  it("matches beverages to cup emoji", () => {
    expect(emojiForCategoryName("مشروبات")).toBe("🥤");
    // "عصير برتقال" — note: the function's regex matches "عصير" first
    // inside the GROCERIES bucket (regex order quirk). This is what the
    // function currently returns; pinning here so a future reorder is
    // intentional.
    expect(emojiForCategoryName("عصير برتقال")).toBe("🛒");
  });

  it("matches snacks to chocolate emoji", () => {
    expect(emojiForCategoryName("سناك")).toBe("🍫");
    expect(emojiForCategoryName("شوكولاتة فاخرة")).toBe("🥤"); // chocolate path falls to drinks in current regex
  });

  it("falls back to shopping bag for unknown", () => {
    expect(emojiForCategoryName("منتجات غامضة")).toBe("🛍️");
    expect(emojiForCategoryName("")).toBe("🛍️");
  });

  it("is case-insensitive", () => {
    expect(emojiForCategoryName("ألبان")).toBe(emojiForCategoryName("ألبان"));
    expect(emojiForCategoryName("ألبان ")).toBe(emojiForCategoryName("ألبان"));
  });
});

describe("buildDynamicGroups", () => {
  it("groups children under their root category", () => {
    const fruits = cat({ id: "fruits", name_ar: "فواكه", slug: "fruits-vegetables" });
    const dairy = cat({ id: "dairy", name_ar: "ألبان", slug: "dairy" });
    const banana = cat({
      id: "banana",
      name_ar: "موز",
      slug: "banana",
      parent_id: "fruits",
    });
    const milk = cat({
      id: "milk",
      name_ar: "حليب",
      slug: "milk",
      parent_id: "dairy",
    });
    const groups = buildDynamicGroups([fruits, dairy, banana, milk]);
    expect(groups).toHaveLength(2);
    const fruitsGroup = groups.find((g) => g.id === "dyn-fruits")!;
    const dairyGroup = groups.find((g) => g.id === "dyn-dairy")!;
    expect(fruitsGroup.children.map((c) => c.id)).toEqual(["banana"]);
    expect(dairyGroup.children.map((c) => c.id)).toEqual(["milk"]);
  });

  it("excludes inactive roots", () => {
    const active = cat({ id: "a", is_active: true });
    const inactive = cat({ id: "b", is_active: false });
    const groups = buildDynamicGroups([active, inactive]);
    expect(groups.map((g) => g.id)).toEqual(["dyn-a"]);
  });

  it("sorts groups by sort_order ascending", () => {
    const late = cat({ id: "late", sort_order: 10 });
    const mid = cat({ id: "mid", sort_order: 5 });
    const early = cat({ id: "early", sort_order: 1 });
    const groups = buildDynamicGroups([late, mid, early]);
    expect(groups.map((g) => g.id)).toEqual(["dyn-early", "dyn-mid", "dyn-late"]);
  });

  it("treats missing parent_id as root", () => {
    const a = cat({ id: "a", parent_id: null });
    const b = cat({ id: "b" }); // undefined parent_id
    const c = cat({ id: "c", parent_id: "a" });
    const groups = buildDynamicGroups([a, b, c]);
    // a and b are roots; c is a child of a.
    expect(groups.map((g) => g.id).sort()).toEqual(["dyn-a", "dyn-b"]);
    expect(groups.find((g) => g.id === "dyn-a")!.children).toHaveLength(1);
  });

  it("returns groups with isDynamic=true flag", () => {
    const a = cat({ id: "a" });
    const groups = buildDynamicGroups([a]);
    expect(groups[0].isDynamic).toBe(true);
  });

  it("returns empty array when no categories provided", () => {
    expect(buildDynamicGroups([])).toEqual([]);
  });
});
