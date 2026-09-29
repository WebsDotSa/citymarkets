import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

/**
 * Tests for the SEO sitemap source helpers.
 *
 * Strategy: mock `@/lib/db`'s `query` to capture the SQL and return canned
 * rows. Each query handler is matched by the SQL shape so we can return
 * different rows for categories / products / offers.
 */

const calls: { sql: string; params: unknown[] }[] = [];
let nextQueryRows: unknown[] = [];

vi.mock("@/lib/db", () => ({
  query: vi.fn(async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    return { rows: nextQueryRows };
  }),
}));

import {
  staticSitemapEntries,
  categorySitemapEntries,
  productSitemapEntries,
  offerSitemapEntries,
  buildFullSitemap,
  type SitemapEntry,
} from "./sitemap-sources";

beforeEach(() => {
  vi.clearAllMocks();
  calls.length = 0;
  nextQueryRows = [];
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("staticSitemapEntries", () => {
  it("emits one entry per public static path with deterministic priorities", () => {
    const entries = staticSitemapEntries();
    const paths = entries.map((e) => new URL(e.url).pathname);
    // Spot-check a few of the must-have routes.
    expect(paths).toContain("/");
    expect(paths).toContain("/catalog");
    expect(paths).toContain("/categories");
    expect(paths).toContain("/offers");
    expect(paths).toContain("/terms");
    expect(paths).toContain("/privacy");
  });

  it("the home entry has the highest priority (1.0) and changeFrequency daily", () => {
    const home = staticSitemapEntries().find((e) => new URL(e.url).pathname === "/");
    expect(home).toBeDefined();
    expect(home!.priority).toBe(1);
    expect(home!.changeFrequency).toBe("daily");
  });

  it("lower-priority legal/info pages have monthly changeFrequency", () => {
    const legal = staticSitemapEntries().find((e) => new URL(e.url).pathname === "/terms");
    expect(legal!.changeFrequency).toBe("monthly");
    expect(legal!.priority).toBeLessThan(0.5);
  });

  it("all static entries have a lastModified Date", () => {
    const entries = staticSitemapEntries();
    for (const e of entries) {
      expect(e.lastModified).toBeInstanceOf(Date);
    }
  });

  it("all static entries use https URLs (no protocol-relative)", () => {
    const entries = staticSitemapEntries();
    for (const e of entries) {
      expect(e.url.startsWith("https://")).toBe(true);
    }
  });
});

describe("categorySitemapEntries", () => {
  it("queries the categories table and emits one entry per slug", async () => {
    nextQueryRows = [{ slug: "dairy" }, { slug: "bakery" }];
    const entries = await categorySitemapEntries();
    expect(entries.length).toBe(2);
    expect(entries[0].url).toMatch(/\/categories\/dairy$/);
    expect(entries[1].url).toMatch(/\/categories\/bakery$/);
  });

  it("encodeURIComponent protects against special characters in slugs", async () => {
    nextQueryRows = [{ slug: "فواكه/طازة" }];
    const entries = await categorySitemapEntries();
    expect(entries[0].url).toContain(encodeURIComponent("فواكه/طازة"));
    expect(entries[0].url).not.toContain("فواكه/طازة");
  });

  it("uses priority 0.85 and changeFrequency daily", async () => {
    nextQueryRows = [{ slug: "x" }];
    const entries = await categorySitemapEntries();
    expect(entries[0].priority).toBe(0.85);
    expect(entries[0].changeFrequency).toBe("daily");
  });

  it("emits an entry for every row, including ones with empty slugs (the SQL filters them)", async () => {
    // The SQL is responsible for filtering out empty slugs; the function
    // simply maps rows. We test that the SQL itself includes the
    // NULL/empty guards.
    nextQueryRows = [];
    await categorySitemapEntries();
    const sql = calls[0].sql;
    expect(sql).toMatch(/FROM categories/i);
    expect(sql).toMatch(/slug IS NOT NULL/i);
    expect(sql).toMatch(/TRIM\(slug\)\s*<>\s*''/);
  });
});

describe("productSitemapEntries", () => {
  it("queries products_unified and emits one entry per active product", async () => {
    nextQueryRows = [
      { id: "uuid-1", updated_at: new Date("2026-07-01") },
      { id: "uuid-2", updated_at: new Date("2026-07-15") },
    ];
    const entries = await productSitemapEntries();
    expect(entries.length).toBe(2);
    expect(entries[0].url).toMatch(/\/products\/uuid-1$/);
    expect(entries[1].url).toMatch(/\/products\/uuid-2$/);
  });

  it("uses products_unified (not bare 'products') and filters is_active=true", async () => {
    nextQueryRows = [];
    await productSitemapEntries();
    const sql = calls[0].sql;
    expect(sql).toMatch(/FROM\s+products_unified/i);
    expect(sql).toMatch(/is_active = true/i);
  });

  it("uses the row's updated_at as lastModified when present", async () => {
    const ts = new Date("2026-05-20T10:00:00Z");
    nextQueryRows = [{ id: "u1", updated_at: ts }];
    const entries = await productSitemapEntries();
    expect(entries[0].lastModified.getTime()).toBe(ts.getTime());
  });

  it("uses weekly changeFrequency and 0.7 priority", async () => {
    nextQueryRows = [{ id: "u1", updated_at: new Date() }];
    const entries = await productSitemapEntries();
    expect(entries[0].changeFrequency).toBe("weekly");
    expect(entries[0].priority).toBe(0.7);
  });
});

describe("offerSitemapEntries", () => {
  it("queries the offers table and emits one entry per in-window, active offer", async () => {
    nextQueryRows = [
      { id: "off-1", updated_at: new Date("2026-07-01") },
      { id: "off-2", updated_at: new Date("2026-07-15") },
    ];
    const entries = await offerSitemapEntries();
    expect(entries.length).toBe(2);
    expect(entries[0].url).toMatch(/\/offers\/off-1$/);
    expect(entries[1].url).toMatch(/\/offers\/off-2$/);
  });

  it("filters by is_active=TRUE AND NOW() BETWEEN starts_at AND ends_at (public-visible only)", async () => {
    nextQueryRows = [];
    await offerSitemapEntries();
    const sql = calls[0].sql;
    expect(sql).toMatch(/FROM\s+offers/i);
    expect(sql).toMatch(/is_active\s*=\s*TRUE/i);
    expect(sql).toMatch(/NOW\(\)\s+BETWEEN\s+starts_at\s+AND\s+ends_at/i);
  });

  it("uses daily changeFrequency and 0.8 priority (offers change more often than products)", async () => {
    nextQueryRows = [{ id: "off-1", updated_at: new Date() }];
    const entries = await offerSitemapEntries();
    expect(entries[0].changeFrequency).toBe("daily");
    expect(entries[0].priority).toBe(0.8);
  });
});

describe("buildFullSitemap", () => {
  it("concatenates static + categories + products + offers", async () => {
    let idx = 0;
    const { query } = await import("@/lib/db");
    vi.mocked(query).mockImplementation(async () => {
      const rows =
        idx === 0
          ? [{ slug: "d1" }]
          : idx === 1
          ? [{ id: "u1", updated_at: new Date() }]
          : [{ id: "off1", updated_at: new Date() }];
      idx++;
      return { rows, rowCount: rows.length, command: "", oid: 0, fields: [] };
    });

    const full = await buildFullSitemap();
    const paths = full.map((e) => new URL(e.url).pathname);
    expect(paths).toContain("/");
    expect(paths).toContain("/categories/d1");
    expect(paths).toContain("/products/u1");
    expect(paths).toContain("/offers/off1");
  });

  it("falls back to static-only when the DB query throws (so a DB outage doesn't 500 the sitemap)", async () => {
    const { query } = await import("@/lib/db");
    vi.mocked(query).mockImplementationOnce(async () => {
      throw new Error("DB down");
    });

    const full = await buildFullSitemap();
    // Static entries are always present.
    expect(full.length).toBeGreaterThan(0);
    expect(full.find((e) => new URL(e.url).pathname === "/")).toBeDefined();
  });
});
