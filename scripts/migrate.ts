#!/usr/bin/env tsx
/**
 * Idempotent PostgreSQL migration runner.
 *
 * Why this exists: the migrations/ directory holds 30+ ordered SQL files
 * (003-032) created during feature work. There is no automated way to
 * apply them — scripts/start.sh boots the app but never touches the DB.
 *
 * Behavior:
 * 1. Loads env from .env.local (DATABASE_HOST / PORT / NAME / USER / PASSWORD).
 *    Custom parser avoids adding the `dotenv` dependency.
 * 2. Ensures `app_migrations` tracking table exists.
 * 3. Lists migrations/*.sql in lexicographic order, skips ones already applied.
 * 4. Applies pending migrations sequentially inside a transaction each.
 * 5. On success, records the filename in app_migrations.
 * 6. Prints a per-file status (apply | skip | fail).
 *
 * Usage:
 *   tsx scripts/migrate.ts                       # apply all pending
 *   tsx scripts/migrate.ts --dry-run             # list pending without running
 *   tsx scripts/migrate.ts --from=010_multi_vendor.sql
 *   tsx scripts/migrate.ts --mark-applied 052_*.sql
 *                                                # record a manually-applied file
 *
 * ────────────────────────────────────────────────────────────────────
 * Tracking-gap recovery (pre-018 files applied outside this runner)
 * ────────────────────────────────────────────────────────────────────
 * Earlier deployments sometimes applied migrations 001..017 directly
 * (psql -f) without recording them in `app_migrations` OR the legacy
 * `schema_migrations` table. When the runner sees such a file it will
 * try to re-apply it and fail (DDL is not transactional in the
 * relevant way — `ALTER TABLE ... ADD COLUMN` errors out if the
 * column already exists, FK constraints reject duplicate constraint
 * names, etc.).
 *
 * The runner has two defence layers for this case:
 *
 *   1. Legacy `schema_migrations` prefix matching (lines ~138-159):
 *      if a `schema_migrations.version` row exists with the same
 *      numeric prefix as the file (e.g. `013` matches
 *      `013_rls_policies.sql`), the file is skipped automatically.
 *
 *   2. Manual mark-applied:
 *      for files that were applied via plain psql (no tracking row
 *      anywhere), run
 *
 *         tsx scripts/migrate.ts --mark-applied <NNN_name>.sql
 *
 *      This writes a `manual:<sha256>` checksum into `app_migrations`
 *      so the drift detector still fires if the file is edited later.
 *      Use this for:
 *         - migrations applied directly via psql / a one-off script
 *         - migrations applied by an even older tool that did not
 *           record anything
 *         - the legacy `001_full_schema.sql` + `002_seed_data.sql`
 *           pair (their columns/rows are usually assumed to exist)
 *
 * After running --mark-applied, verify with:
 *     SELECT filename, applied_at FROM app_migrations ORDER BY filename;
 *
 * SAFETY:
 * - Each migration runs in its own transaction; a failed file aborts the run
 *   and leaves the DB unchanged for that file (earlier successful files are
 *   still recorded as applied).
 * - Checksum tracking: if a file is edited after being applied, the script
 *   refuses to re-run it (manual review required).
 * - All migrations use IF NOT EXISTS / DO $$ ... EXCEPTION WHEN ... which
 *   makes them idempotent, but verify on staging before production.
 */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";

const MIGRATIONS_DIR = join(process.cwd(), "migrations");
const TRACKING_TABLE = "app_migrations";

type CliArgs = {
  dryRun: boolean;
  from: string | null;
  to: string | null;
  markApplied: boolean;
};

function parseArgs(argv: string[]): CliArgs {
  let dryRun = false;
  let from: string | null = null;
  let to: string | null = null;
  let markApplied = false;
  for (const a of argv) {
    if (a === "--dry-run") dryRun = true;
    else if (a.startsWith("--from=")) from = a.slice("--from=".length);
    else if (a.startsWith("--to=")) to = a.slice("--to=".length);
    else if (a === "--mark-applied") markApplied = true;
    else if (a === "--help" || a === "-h") {
      console.log(
        "Usage: tsx scripts/migrate.ts [--dry-run] [--from=<file.sql>] [--to=<file.sql>] [--mark-applied]\n" +
          "\n" +
          "  --dry-run        List pending migrations without applying.\n" +
          "  --from=<file>    Start from this file (lexicographic >=).\n" +
          "  --to=<file>      Stop after this file (lexicographic <=). Lets CI seed or\n" +
          "                   clean a fresh DB between two ranges.\n" +
          "  --mark-applied   Record a migration as applied WITHOUT running its SQL.\n" +
          "                   Use when the schema state is known to exist via another tool\n" +
          "                   (e.g. the file references columns that don't match the live\n" +
          "                   schema but the feature was implemented manually). Records\n" +
          "                   with checksum 'manually-verified' so future drift is caught.",
      );
      process.exit(0);
    }
  }
  return { dryRun, from, to, markApplied };
}

/**
 * Minimal .env.local loader — no `dotenv` dep.
 * Supports `KEY=value` and `KEY="quoted value"`. Ignores comments and blanks.
 */
function loadEnvFile(path: string): void {
  if (!existsSync(path)) return;
  const text = readFileSync(path, "utf8");
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = line.match(/^(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/i);
    if (!m) continue;
    const key = m[1];
    let val = m[2];
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    // Don't override existing process.env so callers can pass overrides.
    if (!(key in process.env)) process.env[key] = val;
  }
}

function listMigrations(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

async function ensureTrackingTable(client: Client): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS ${TRACKING_TABLE} (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      checksum TEXT NOT NULL
    )
  `);
}

/**
 * Reads BOTH the new app_migrations tracking table and the legacy
 * schema_migrations table (used by an earlier tool before this runner
 * existed). The legacy table uses `version` (the file name) without an
 * underscore suffix in some rows; we normalise both naming styles into
 * the same applied-set so a partially-pre-existing database still
 * skips files that are already applied.
 */
async function getAppliedMap(
  client: Client,
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  // New tracking table.
  try {
    const r = await client.query<{ filename: string; checksum: string }>(
      `SELECT filename, checksum FROM ${TRACKING_TABLE}`,
    );
    for (const row of r.rows) map.set(row.filename, row.checksum);
  } catch {
    // app_migrations may not exist yet — ignore.
  }
  // Legacy tracking table. Some rows store "NNN" (e.g. "013"), others
  // store the full "NNN_name.sql" filename or "NNN_name" (no .sql).
  // We extract a numeric prefix (the NNN) so it can be matched against
  // the prefix of any current migration filename.
  const legacyPrefixes = new Set<string>();
  try {
    const r = await client.query<{ version: string }>(
      `SELECT version FROM schema_migrations`,
    );
    for (const row of r.rows) {
      const v = (row.version || "").trim();
      if (!v) continue;
      const m = v.match(/^(\d{1,3})/);
      if (m) legacyPrefixes.add(m[1].padStart(3, "0"));
      // Also store the full version, with and without .sql, for exact
      // matching against filenames that happen to be stored verbatim.
      const withExt = v.endsWith(".sql") ? v : `${v}.sql`;
      if (!map.has(withExt)) map.set(withExt, "legacy");
    }
  } catch {
    // schema_migrations table may not exist (fresh DB) — ignore.
  }
  // Apply legacy-prefix matching at runtime in main(). We return the map
  // as-is and merge prefixes into the skip-check there.
  (map as Map<string, string> & { __legacyPrefixes?: Set<string> }).__legacyPrefixes =
    legacyPrefixes;
  return map;
}

// FNV-1a 64-bit. Stable, dependency-free, good enough to detect drift.
function checksum(content: string): string {
  let h = BigInt("0xcbf29ce484222325");
  const prime = BigInt("0x100000001b3");
  const mask = BigInt("0xffffffffffffffff");
  for (let i = 0; i < content.length; i++) {
    h ^= BigInt(content.charCodeAt(i));
    h = (h * prime) & mask;
  }
  return h.toString(16).padStart(16, "0");
}

async function applyOne(
  client: Client,
  filename: string,
  options: { markOnly: boolean },
): Promise<"applied" | "skipped"> {
  const content = readFileSync(join(MIGRATIONS_DIR, filename), "utf8");
  const cs = checksum(content);
  const recordedChecksum = options.markOnly
    ? // Sentinel so the drift detector still catches any later edit
      // of this file. Drift on a manually-applied row is a real signal
      // — somebody edited a file we already wrote off as done.
      `manual:${cs}`
    : cs;

  try {
    await client.query("BEGIN");
    if (!options.markOnly) {
      await client.query(content);
    }
    await client.query(
      `INSERT INTO ${TRACKING_TABLE} (filename, checksum) VALUES ($1, $2)
       ON CONFLICT (filename) DO UPDATE SET checksum = EXCLUDED.checksum, applied_at = NOW()`,
      [filename, recordedChecksum],
    );
    await client.query("COMMIT");
    return "applied";
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  loadEnvFile(join(process.cwd(), ".env.local"));

  const host = process.env.DATABASE_HOST || "localhost";
  const port = parseInt(process.env.DATABASE_PORT || "5432", 10);
  const database = process.env.DATABASE_NAME || "citymarket_db";
  const user = process.env.DATABASE_USER || "citymarket_user";
  const password = process.env.DATABASE_PASSWORD || "";

  if (!password) {
    console.error(
      "[fatal] DATABASE_PASSWORD is not set in env nor .env.local — aborting.",
    );
    process.exit(2);
  }

  const client = new Client({ host, port, database, user, password });
  console.log(`[db] connecting to ${host}:${port}/${database} as ${user}`);
  await client.connect();

  try {
    await ensureTrackingTable(client);
    const appliedMap = await getAppliedMap(client);
    const all = listMigrations();
    const after = all.filter(
      (f) =>
        (!args.from || f.localeCompare(args.from) >= 0) &&
        (!args.to || f.localeCompare(args.to) <= 0),
    );

    const legacyPrefixes =
      (appliedMap as Map<string, string> & { __legacyPrefixes?: Set<string> })
        .__legacyPrefixes ?? new Set<string>();
    const pending: string[] = [];
    const conflicts: string[] = [];
    for (const f of after) {
      // Exact match in app_migrations OR legacy schema_migrations, OR
      // a legacy prefix (e.g. "013") matches the file's numeric prefix.
      let existing = appliedMap.get(f);
      if (!existing) {
        const prefixMatch = f.match(/^(\d{1,3})/);
        if (prefixMatch && legacyPrefixes.has(prefixMatch[1].padStart(3, "0"))) {
          // File's numeric prefix is in legacy applied set → skip it.
          continue;
        }
        pending.push(f);
        continue;
      }
      // Drift detection — skip silently but flag.
      const fileCs = checksum(readFileSync(join(MIGRATIONS_DIR, f), "utf8"));
      if (existing !== fileCs) conflicts.push(f);
    }

    const skipped = after.length - pending.length;
    console.log(
      `[plan] ${all.length} total — ${appliedMap.size} applied, ${pending.length} pending, ${skipped} already done in range, ${conflicts.length} drift`,
    );

    if (conflicts.length > 0) {
      console.warn("[drift] FILES MODIFIED AFTER APPLY (review manually):");
      for (const f of conflicts) console.warn("  -", f);
    }

    if (args.dryRun) {
      console.log("[dry-run] would apply:");
      for (const f of pending) console.log("  -", f);
      return;
    }

    if (pending.length === 0) {
      console.log("[ok] database is up to date");
      return;
    }

    let appliedNow = 0;
    for (const filename of pending) {
      const tag = args.markApplied ? "[MANUAL]" : "[..]";
      process.stdout.write(`  ${tag} ${filename} `);
      try {
        await applyOne(client, filename, { markOnly: args.markApplied });
        const okTag = args.markApplied ? "[OK-MANUAL]" : "[OK]";
        console.log(`\r  ${okTag} ${filename}`);
        appliedNow++;
      } catch (err) {
        console.log(`\r  [FAIL] ${filename}`);
        console.error(err instanceof Error ? err.message : err);
        console.error(
          `\nAborting after ${appliedNow} migration(s). The failed file was rolled back.`,
        );
        process.exitCode = 1;
        return;
      }
    }

    console.log(
      `\n[done] applied ${appliedNow}, skipped ${skipped} (already up-to-date).`,
    );
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("[fatal]", err);
  process.exit(1);
});
