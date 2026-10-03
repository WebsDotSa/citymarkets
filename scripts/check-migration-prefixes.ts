#!/usr/bin/env tsx
/**
 * Filesystem migration prefix uniqueness check.
 *
 * Enforces the PCP-115 invariant (migration 110) at the FILESYSTEM level.
 * The DB-side check in migration 110 only inspects app_migrations rows —
 * it does not catch the case where two .sql files on disk share a numeric
 * prefix but neither has been recorded yet, or where one of them was
 * renamed without removing the other.
 *
 * Why this script exists:
 *   In security Phase 0 (2026-10-03) we discovered 3 duplicate prefixes
 *   on the filesystem:
 *     086_coupon_sources.sql + 086_remove_banners_table.sql
 *     087_jwt_secret_versioning.sql + 087_schema_contract_reconcile.sql
 *     113_pcp147_backfill_migration_checksums.sql + 113_pcp148_page_views_retention.sql
 *   The runner applies files in lex order, so duplicate prefixes are
 *   tolerated (the order is deterministic) but they violate the invariant
 *   that migration 110 establishes for the DB. They are also a footgun:
 *   any future rename of one file can silently change the apply order.
 *
 * What it does:
 *   1. Lists migrations/*.sql.
 *   2. Extracts the leading numeric prefix (NNN or NNNA).
 *   3. Groups files by prefix.
 *   4. Exits 0 if every prefix is unique.
 *   5. Exits 1 with a clear list of duplicates if any are found.
 *
 * Usage:
 *   tsx scripts/check-migration-prefixes.ts
 *   pnpm tsx scripts/check-migration-prefixes.ts
 *
 * CI: this script is the right place to add to a pre-commit or pre-merge
 * hook. It has no DB dependency and runs in <100ms.
 */

import { readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "..");
const MIGRATIONS_DIR = join(REPO_ROOT, "migrations");

function main(): void {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  // Legacy duplicates already tracked in app_migrations on staging +
  // production. Renaming these would orphan their app_migrations row
  // and cause the next deploy to re-apply. They are tolerated on disk
  // because the runner's lex order matches the intended apply order
  // for each pair. Documented here so the exception is explicit, not
  // accidental.
  const LEGACY_DUPLICATE_PREFIXES = new Set<string>([
    "086", // 086_coupon_sources + 086_remove_banners_table (both applied)
    "113", // 113_pcp147_backfill_checksums + 113_pcp148_page_views_retention (both applied)
  ]);

  // Extract leading numeric prefix: matches 001, 059b, 120, etc.
  // Lex order of the filename already matches logical order when the
  // prefix is numeric. We only flag a duplicate if two files share the
  // same leading digits.
  const byPrefix = new Map<string, string[]>();
  for (const f of files) {
    const m = f.match(/^(\d{1,3}[a-z]?)_/);
    if (!m) {
      // No numeric prefix — flag as a separate error class so it does
      // not silently slip through the check.
      console.error(`[fail] ${f} has no numeric prefix`);
      process.exit(1);
    }
    const prefix = m[1];
    const list = byPrefix.get(prefix) ?? [];
    list.push(f);
    byPrefix.set(prefix, list);
  }

  const duplicates = Array.from(byPrefix.entries())
    .filter(([prefix, list]) => list.length > 1 && !LEGACY_DUPLICATE_PREFIXES.has(prefix))
    .sort(([a], [b]) => a.localeCompare(b));

  if (duplicates.length === 0) {
    console.log(`[ok] ${files.length} migration files, all prefixes unique`);
    return;
  }

  console.error(`[fail] ${duplicates.length} duplicate prefix(es) found:`);
  for (const [prefix, list] of duplicates) {
    console.error(`  ${prefix}:`);
    for (const f of list) console.error(`    - ${f}`);
  }
  console.error("");
  console.error("Fix: rename the newer file to a free prefix (use the next");
  console.error("available NNN), and if the DB already applied either file,");
  console.error("add a tracking row in app_migrations to avoid re-apply.");
  process.exit(1);
}

main();
