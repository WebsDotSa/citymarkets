import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { productDescription, productAltText, type ProductSeoRow } from "./product";

const base: ProductSeoRow = {
  id: "abc",
  name_ar: "بسكويت اولكر",
  name_en: null,
  description: "بسكويت شوكولاتة لذيذ",
  image_url: "/x.jpg",
  price: 5,
  discount_price: null,
  category_name: "بسكويت",
  category_slug: "biscuits",
  category_icon: null,
  is_active: true,
  sku: null,
  stock_qty: 10,
};

describe("productDescription", () => {
  it("includes description + category + price", () => {
    const out = productDescription(base);
    expect(out).toContain("بسكويت شوكولاتة لذيذ");
    expect(out).toContain("قسم بسكويت");
    expect(out).toContain("5.00 ر.س");
  });

  it("uses discount price when present and lower", () => {
    const out = productDescription({ ...base, discount_price: 3 });
    expect(out).toContain("3.00 ر.س");
    expect(out).not.toContain("5.00 ر.س");
  });

  it("ignores discount when higher than price", () => {
    const out = productDescription({ ...base, discount_price: 99 });
    expect(out).toContain("5.00 ر.س");
  });

  it("handles null description", () => {
    const out = productDescription({ ...base, description: null });
    expect(out).toContain("قسم بسكويت");
    expect(out).toContain("5.00 ر.س");
  });

  it("handles null category", () => {
    const out = productDescription({ ...base, category_name: null });
    expect(out).not.toContain("قسم");
    expect(out).toContain("5.00 ر.س");
  });

  it("truncates to <= 160 chars", () => {
    const long = "x".repeat(500);
    const out = productDescription({ ...base, description: long });
    expect(out.length).toBeLessThanOrEqual(160);
  });
});

describe("productAltText", () => {
  it("includes name + category + price", () => {
    expect(productAltText(base)).toBe("بسكويت اولكر - بسكويت - 5.00 ر.س");
  });

  it("uses discount price when lower", () => {
    expect(productAltText({ ...base, discount_price: 2.5 })).toBe(
      "بسكويت اولكر - بسكويت - 2.50 ر.س"
    );
  });

  it("omits category when null", () => {
    expect(productAltText({ ...base, category_name: null })).toBe(
      "بسكويت اولكر - 5.00 ر.س"
    );
  });
});

// ---------------------------------------------------------------------------
// DB-backed helpers: getProductForSeo, getCategoryForSeo, getCategoryByNameAr
// ---------------------------------------------------------------------------

const calls: { sql: string; params: unknown[] }[] = [];
let nextQueryResult: { rows: unknown[] } = { rows: [] };

vi.mock("@/lib/db", () => ({
  query: vi.fn(async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    return nextQueryResult;
  }),
}));

// Late import so the mock above is registered first.
import {
  getProductForSeo,
  getCategoryForSeo,
  getCategoryByNameAr,
  type CategorySeoRow,
} from "./product";

beforeEach(() => {
  vi.clearAllMocks();
  calls.length = 0;
  nextQueryResult = { rows: [] };
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("getProductForSeo", () => {
  // Use UUID-shaped strings because the implementation short-circuits
  // non-UUID inputs (see UUID_LIKE in product.ts) to avoid wasting a
  // round-trip on malformed share-links.
  const UUID = "00000000-0000-0000-0000-000000000abc";

  it("returns null when the query yields no rows", async () => {
    nextQueryResult = { rows: [] };
    const res = await getProductForSeo(UUID);
    expect(res).toBeNull();
  });

  it("returns the first row when found", async () => {
    nextQueryResult = { rows: [base] };
    const res = await getProductForSeo(UUID);
    expect(res).toEqual(base);
  });

  it("queries the products_unified view (not bare 'products')", async () => {
    nextQueryResult = { rows: [base] };
    await getProductForSeo(UUID);
    expect(calls.length).toBe(1);
    const sql = calls[0].sql;
    expect(sql).toMatch(/FROM\s+products_unified/i);
    expect(sql).not.toMatch(/FROM\s+products\b(?!_unified)/i);
  });

  it("LEFT JOINs categories on category_id", async () => {
    nextQueryResult = { rows: [] };
    await getProductForSeo(UUID);
    expect(calls[0].sql).toMatch(/LEFT JOIN categories c ON p\.category_id = c\.id/i);
  });

  it("passes the id as the first parameter", async () => {
    nextQueryResult = { rows: [] };
    await getProductForSeo(UUID);
    expect(calls[0].params).toEqual([UUID]);
  });
});

describe("getCategoryForSeo", () => {
  const cat: CategorySeoRow = {
    id: "c-1",
    name_ar: "بسكويت",
    slug: "biscuits",
    icon_url: null,
    description_ar: null,
    parent_slug: null,
    parent_name_ar: null,
  };

  it("returns null when not found", async () => {
    nextQueryResult = { rows: [] };
    const res = await getCategoryForSeo("nope");
    expect(res).toBeNull();
  });

  it("returns the first row when found", async () => {
    nextQueryResult = { rows: [cat] };
    const res = await getCategoryForSeo("biscuits");
    expect(res).toEqual(cat);
  });

  it("uses a recursive CTE that walks parent->child visible categories", async () => {
    nextQueryResult = { rows: [] };
    await getCategoryForSeo("biscuits");
    const sql = calls[0].sql;
    expect(sql).toMatch(/WITH RECURSIVE visible/i);
    expect(sql).toMatch(/UNION ALL/i);
  });

  it("filters by c.is_active = TRUE in the visible CTE", async () => {
    nextQueryResult = { rows: [] };
    await getCategoryForSeo("biscuits");
    expect(calls[0].sql).toMatch(/is_active = TRUE/i);
  });

  it("matches strictly by slug (not by Arabic name) to keep canonical URLs stable", async () => {
    nextQueryResult = { rows: [] };
    await getCategoryForSeo("biscuits");
    expect(calls[0].sql).toMatch(/WHERE\s+c\.slug\s+=\s+\$1/);
    expect(calls[0].sql).not.toMatch(/WHERE\s+c\.name_ar/);
  });
});

describe("getCategoryByNameAr", () => {
  const cat: CategorySeoRow = {
    id: "c-1",
    name_ar: "بسكويت",
    slug: "biscuits",
    icon_url: null,
    description_ar: null,
    parent_slug: null,
    parent_name_ar: null,
  };

  it("returns null when not found", async () => {
    nextQueryResult = { rows: [] };
    const res = await getCategoryByNameAr("بسكويت");
    expect(res).toBeNull();
  });

  it("returns the first row when found", async () => {
    nextQueryResult = { rows: [cat] };
    const res = await getCategoryByNameAr("بسكويت");
    expect(res).toEqual(cat);
  });

  it("matches by name_ar (not by slug)", async () => {
    nextQueryResult = { rows: [] };
    await getCategoryByNameAr("بسكويت");
    expect(calls[0].sql).toMatch(/WHERE\s+c\.name_ar\s+=\s+\$1/);
    expect(calls[0].params).toEqual(["بسكويت"]);
  });
});
