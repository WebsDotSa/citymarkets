#!/usr/bin/env tsx
/**
 * Migration drift report — compares the live PostgreSQL schema against the
 * tracked SQL migrations, plus the EXPECT_TABLES baseline used by qa-smoke.
 *
 * Why this exists:
 *   The project's migration history includes reconciliation and rollback
 *   artifacts (README §"حالة التنفيذ الموثقة"; docs/06). The runner
 *   `scripts/migrate.ts` records 018+ in `app_migrations`; pre-018 ALTER
 *   TABLE migrations can be silently skipped, leaving columns missing on
 *   the live DB. `scripts/migration-diagnostics.ts` covers three specific
 *   checks but is intentionally narrow.
 *
 * What this script reports:
 *   1. Tables present in live DB but NOT referenced in any migration file.
 *      (Manual SQL or external side-channel — needs review.)
 *   2. Tables expected by qa-smoke (EXPECT_TABLES) that are MISSING from
 *      the live DB. (Migration not applied or table dropped.)
 *   3. Migrations recorded in `app_migrations` whose file no longer exists
 *      on disk (history drift — happened with 060b/060c rollbacks).
 *   4. Migration files on disk that have never been recorded (forward
 *      drift — applies to new files like 073).
 *
 * Output:
 *   - Human-readable summary on stdout.
 *   - JSON report at scripts/out/migration-drift.json.
 *
 * Run with:
 *   tsx scripts/migration-drift-report.ts
 *
 * Exit code: 0 if clean, 1 if drift detected, 2 if connection failed.
 */

import { Client } from "pg";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "..");

// ── env loader (mirrors scripts/migration-diagnostics.ts) ──
function loadEnvLocal(): void {
  const p = join(REPO_ROOT, ".env.local");
  if (!existsSync(p)) return;
  const text = readFileSync(p, "utf8");
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadEnvLocal();

function dbConfig() {
  return {
    host: process.env.DATABASE_HOST || "127.0.0.1",
    port: parseInt(process.env.DATABASE_PORT || "5432", 10),
    database: process.env.DATABASE_NAME || "citymarket_db",
    user: process.env.DATABASE_USER || "citymarket_user",
    password: process.env.DATABASE_PASSWORD || "",
    ssl:
      process.env.DATABASE_SSL === "false"
        ? false
        : { rejectUnauthorized: false },
    family: 4,
    connectionTimeoutMillis: 5000,
  };
}

// ── expected baseline (mirrors scripts/qa-smoke.mjs EXPECT_TABLES) ──
const EXPECT_TABLES = [
  "addresses",
  "admin_users",
  "ai_sessions",
  "banners",
  "cart",
  "categories",
  "coupons",
  "direct_orders",
  "drivers",
  "guest_cart",
  "home_inventory",
  "loyalty_transactions",
  "notifications",
  "order_items",
  "orders",
  "products",
  "reviews",
  "saved_lists",
  "spin_results",
  "users",
  "wallet_transactions",
];

/**
 * Lightweight table-name extractor from a SQL file. We pull every
 * `CREATE TABLE [IF NOT EXISTS] <name>` and `ALTER TABLE [IF NOT EXISTS] <name>`
 * reference. False positives are acceptable for a drift report — we only
 * need the union of references, not a perfect parse.
 */
function extractTableRefs(sql: string): Set<string> {
  const refs = new Set<string>();
  // CREATE TABLE [IF NOT EXISTS] table_name
  const createRe = /\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:"?([a-zA-Z0-9_]+)"?\.)?"?([a-zA-Z0-9_]+)"?/gi;
  for (const m of sql.matchAll(createRe)) {
    refs.add((m[2] || m[1]).toLowerCase());
  }
  // ALTER TABLE [IF EXISTS|ONLY] [schema.]name
  const alterRe = /\bALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?(?:"?([a-zA-Z0-9_]+)"?\.)?"?([a-zA-Z0-9_]+)"?/gi;
  for (const m of sql.matchAll(alterRe)) {
    refs.add((m[2] || m[1]).toLowerCase());
  }
  // DROP TABLE [IF EXISTS] name
  const dropRe = /\bDROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:"?([a-zA-Z0-9_]+)"?\.)?"?([a-zA-Z0-9_]+)"?/gi;
  for (const m of sql.matchAll(dropRe)) {
    refs.add(`__drop__:${(m[2] || m[1]).toLowerCase()}`);
  }
  return refs;
}

interface DriftReport {
  generated_at: string;
  database: string;
  untracked_tables: string[];          // live tables not in any migration file
  expected_missing_tables: string[];    // EXPECT_TABLES rows missing live
  applied_files_missing_on_disk: string[]; // app_migrations rows whose file is gone
  unapplied_files_on_disk: string[];   // files in /migrations not yet applied
  tracked_table_union: string[];
  live_table_count: number;
  migration_file_count: number;
}

async function main() {
  const cfg = dbConfig();
  if (!cfg.password) {
    console.error(
      "DATABASE_PASSWORD not set in env or .env.local — cannot probe live schema.",
    );
    process.exit(2);
  }

  // 1. Enumerate migration files on disk
  const migrationsDir = join(REPO_ROOT, "migrations");
  const filesOnDisk = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  const trackedTableUnion = new Set<string>();
  for (const f of filesOnDisk) {
    const sql = readFileSync(join(migrationsDir, f), "utf8");
    for (const ref of extractTableRefs(sql)) {
      if (!ref.startsWith("__drop__:")) trackedTableUnion.add(ref);
    }
  }

  // 2. Connect + read live schema
  const client = new Client(cfg);
  try {
    await client.connect();
  } catch (e) {
    console.error(
      `Cannot connect to ${cfg.host}:${cfg.port}/${cfg.database} — ${e instanceof Error ? e.message : String(e)}`,
    );
    process.exit(2);
  }

  const liveTablesRes = await client.query<{ tablename: string }>(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`,
  );
  const liveTables = new Set(liveTablesRes.rows.map((r) => r.tablename));

  // 3. Determine if app_migrations exists (runner only records 018+)
  let recordedFiles: Set<string> = new Set();
  let appMigrationsExists = false;
  try {
    const r = await client.query(
      `SELECT to_regclass('public.app_migrations') AS t`,
    );
    appMigrationsExists = Boolean(r.rows[0]?.t);
    if (appMigrationsExists) {
      const rows = await client.query<{ filename: string }>(
        `SELECT filename FROM app_migrations ORDER BY filename`,
      );
      recordedFiles = new Set(rows.rows.map((r) => r.filename));
    }
  } catch {
    appMigrationsExists = false;
  }

  await client.end();

  // 4. Build the drift report
  const untrackedTables = [...liveTables]
    .filter((t) => !trackedTableUnion.has(t))
    .filter((t) => !t.startsWith("_")) // ignore Postgres internal
    .sort();

  const expectedMissingTables = EXPECT_TABLES.filter((t) => !liveTables.has(t));

  const filesOnDiskSet = new Set(filesOnDisk);
  const appliedFilesMissingOnDisk = [...recordedFiles]
    .filter((f) => !filesOnDiskSet.has(f))
    .sort();
  const unappliedFilesOnDisk = filesOnDisk.filter((f) => !recordedFiles.has(f));

  const report: DriftReport = {
    generated_at: new Date().toISOString(),
    database: `${cfg.host}/${cfg.database}`,
    untracked_tables: untrackedTables,
    expected_missing_tables: expectedMissingTables,
    applied_files_missing_on_disk: appliedFilesMissingOnDisk,
    unapplied_files_on_disk: unappliedFilesOnDisk,
    tracked_table_union: [...trackedTableUnion].sort(),
    live_table_count: liveTables.size,
    migration_file_count: filesOnDisk.length,
  };

  // 5. Emit JSON
  const outDir = join(REPO_ROOT, "scripts", "out");
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, "migration-drift.json");
  writeFileSync(outPath, JSON.stringify(report, null, 2));

  // 6. Human-readable summary
  console.log("\n═══ Migration Drift Report ═══\n");
  console.log(`Database:           ${report.database}`);
  console.log(`Live tables:        ${report.live_table_count}`);
  console.log(`Migration files:    ${report.migration_file_count}`);
  console.log(`app_migrations:     ${appMigrationsExists ? "present" : "absent"}`);
  console.log("");
  console.log(`Untracked tables:   ${untrackedTables.length}`);
  for (const t of untrackedTables) console.log(`  - ${t}`);
  console.log("");
  console.log(`Expected missing:   ${expectedMissingTables.length}`);
  for (const t of expectedMissingTables) console.log(`  - ${t}`);
  console.log("");
  console.log(`Applied→missing on disk: ${appliedFilesMissingOnDisk.length}`);
  for (const f of appliedFilesMissingOnDisk) console.log(`  - ${f}`);
  console.log("");
  console.log(`Unapplied files:    ${unappliedFilesOnDisk.length}`);
  for (const f of unappliedFilesOnDisk) console.log(`  - ${f}`);
  console.log("");
  console.log(`JSON written:       ${outPath}`);

  const driftCount =
    untrackedTables.length +
    expectedMissingTables.length +
    appliedFilesMissingOnDisk.length;
  if (driftCount > 0) {
    console.log(
      `\n⚠ Drift detected (${driftCount} item${driftCount === 1 ? "" : "s"}).`,
    );
    process.exit(1);
  }
  console.log("\n✓ No drift detected.");
}

main().catch((err) => {
  console.error("drift-report crashed:", err);
  process.exit(2);
});
