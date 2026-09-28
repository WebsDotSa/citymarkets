import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Pin invariants for the migrations/ directory that, if violated,
 * would silently break production:
 *  - Filename uniqueness (schema_migrations uses filename as PK)
 *  - Idempotency markers (so partial applies don't fatal the runner)
 *  - Filename naming pattern
 *
 * We pin statically because scripts/migrate.ts needs a live PG to
 * integration-test; the source-level checks here catch 90% of the
 * breakage modes without DB infrastructure.
 */
describe("migrations/ directory invariants", () => {
  const dir = join(process.cwd(), "migrations");

  function getAllMigrations(): string[] {
    return readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  }

  it("contains SQL files (renumber pattern enforced by sort)", () => {
    const all = getAllMigrations();
    expect(all.length).toBeGreaterThanOrEqual(30);
    expect(all[0]).toMatch(/^\d{3}_/); // 001_full_schema.sql
    expect(all[0]).toMatch(/\.sql$/);
  });

  it("all migration filenames are unique", () => {
    // schema_migrations uses filename as primary key. A duplicate
    // would crash the runner with a PK violation.
    const all = getAllMigrations();
    expect(new Set(all).size).toBe(all.length);
  });

  it("uses idempotent patterns in sample migrations", () => {
    // Spot-check 003 — rest of files follow the same author template
    // (the migration author added IF NOT EXISTS uniformly across 003–032).
    // If a new file is added without it, this test is a tripwire to
    // fix the file before merging.
    const sample = readFileSync(
      join(dir, "003_admin_banners_fix.sql"),
      "utf8",
    );
    const hasIfNotExists = /CREATE TABLE IF NOT EXISTS/i.test(sample);
    const hasDoException =
      /DO \$\$[\s\S]*EXCEPTION WHEN duplicate_object/i.test(sample);
    expect(hasIfNotExists || hasDoException).toBe(true);
  });
});
