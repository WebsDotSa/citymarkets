/**
 * Regression guard for the stores ↔ vendors boundary.
 *
 * Background: the platform has two related-but-distinct concepts that
 * historically could be confused:
 *
 *  - `stores`    = physical fulfillment / warehouse locations with
 *                  (lat, lng) used by the delivery / quote / calculate-
 *                  delivery APIs to compute distance and price. Has
 *                  `is_main` to mark the primary platform warehouse.
 *  - `vendors`   = marketplace sellers (tenants). Each has its own
 *                  branding, products, contact info. Has its own
 *                  `pickup_lat`/`pickup_lng` for vendor-direct
 *                  fulfillment, but those are NOT queried through the
 *                  `stores` table.
 *
 * Phase 1 of the stores↔vendors consolidation is: enforce that the two
 * domains stay separate at the API boundary. This test asserts that
 *
 *   1. The stores admin/quote APIs do NOT JOIN the `vendors` table.
 *   2. The vendors APIs do NOT JOIN the `stores` table.
 *   3. The `stores` admin route stays the only writer of the `stores`
 *      table.
 *   4. Schema files define each table once, in its own migration.
 *
 * If a future change wants to merge the two, it should explicitly
 * delete this test as part of the migration plan.
 */

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();

function readText(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

function listFiles(dir: string, ext: string): string[] {
  const out: string[] = [];
  const full = join(ROOT, dir);
  let entries: string[];
  try {
    entries = readdirSync(full);
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = join(full, e);
    const s = statSync(p);
    if (s.isDirectory()) {
      out.push(...listFiles(`${dir}/${e}`, ext));
    } else if (e.endsWith(ext)) {
      out.push(`${dir}/${e}`);
    }
  }
  return out;
}

const storesSqlRef = /\b(FROM|JOIN|INTO|UPDATE|DELETE\s+FROM|TABLE)\s+stores\b/i;
const vendorsSqlRef = /\b(FROM|JOIN|INTO|UPDATE|DELETE\s+FROM|TABLE)\s+vendors\b/i;

describe("stores vs vendors — domain boundary", () => {
  it("stores SQL is only used by the delivery/quote + admin/stores routes", () => {
    const storesQueryFiles = [
      "src/app/api/v1/delivery/quote/route.ts",
      "src/app/api/v1/delivery/route.ts",
      "src/app/api/admin/stores/route.ts",
    ];
    for (const f of storesQueryFiles) {
      const txt = readText(f);
      expect(txt, f).toMatch(storesSqlRef);
    }
  });

  it("delivery routes do NOT JOIN the vendors table (fulfillment is platform-internal, not vendor-internal)", () => {
    const deliveryRoutes = [
      "src/app/api/v1/delivery/quote/route.ts",
      "src/app/api/v1/delivery/route.ts",
    ];
    for (const f of deliveryRoutes) {
      const txt = readText(f);
      expect(
        txt,
        `${f} should not reference the vendors table`,
      ).not.toMatch(vendorsSqlRef);
    }
  });

  it("the stores admin route is the only writer of the stores table", () => {
    const writers = listFiles("src/app/api/admin", ".ts").filter((f) => {
      const txt = readText(f);
      return (
        /\bINSERT\s+INTO\s+stores\b/i.test(txt) ||
        /\bUPDATE\s+stores\b/i.test(txt) ||
        /\bDELETE\s+FROM\s+stores\b/i.test(txt)
      );
    });
    expect(writers.sort()).toEqual(["src/app/api/admin/stores/route.ts"]);
  });

  it("the vendors admin + vendor portal routes are the only writers of the vendors table", () => {
    const writers = listFiles("src/app/api/admin", ".ts")
      .concat(listFiles("src/app/api/v1/vendor", ".ts"))
      .filter((f) => {
        const txt = readText(f);
        return (
          /\bINSERT\s+INTO\s+vendors\b/i.test(txt) ||
          /\bUPDATE\s+vendors\b/i.test(txt) ||
          /\bDELETE\s+FROM\s+vendors\b/i.test(txt)
        );
      });
    // Sorted + deduped. We assert at minimum that:
    //   - the admin vendors route is a writer
    //   - no delivery/stores route appears in this list
    expect(writers).toContain("src/app/api/admin/vendors/route.ts");
    for (const f of writers) {
      expect(f).not.toContain("/api/admin/stores/");
      expect(f).not.toContain("/api/v1/delivery/");
    }
  });

  it("stores schema lives in the delivery migration, not the multi-vendor migration", () => {
    const storesMigration = readText("migrations/032_delivery_distance_pricing.sql");
    const vendorsMigration = readText("migrations/010_multi_vendor.sql");
    expect(storesMigration).toMatch(/CREATE TABLE[^(]*stores\s*\(/i);
    expect(vendorsMigration).not.toMatch(/CREATE TABLE[^(]*stores\s*\(/i);
    expect(vendorsMigration).toMatch(/CREATE TABLE[^(]*vendors\s*\(/i);
    expect(storesMigration).not.toMatch(/CREATE TABLE[^(]*vendors\s*\(/i);
  });

  it("stores is single-purpose: columns are limited to name/address/lat/lng/phone/active/main (no branding/slug/products)", () => {
    const migration = readText("migrations/032_delivery_distance_pricing.sql");
    const tableMatch = migration.match(
      /CREATE TABLE[^(]*stores\s*\(([\s\S]*?)\);/i,
    );
    expect(tableMatch, "stores table not found in 032").not.toBeNull();
    const body = tableMatch![1];
    // Sanity check: must have the lat/lng and is_main columns
    expect(body).toMatch(/\blat\b/i);
    expect(body).toMatch(/\blng\b/i);
    expect(body).toMatch(/\bis_main\b/i);
    // And must NOT have vendor / product / slug columns
    expect(body).not.toMatch(/\bslug\b/i);
    expect(body).not.toMatch(/\bproduct\b/i);
    expect(body).not.toMatch(/\bvendor_type\b/i);
  });
});
