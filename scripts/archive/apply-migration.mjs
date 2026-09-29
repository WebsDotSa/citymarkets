// Apply a migration manually (host has no tsx, but node + pg works).
// Reusable for any Phase X migration; not part of the regular migrate.ts flow.
import { readFileSync } from "fs";
import { Pool } from "pg";
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

const migrations = process.argv.slice(2);
if (migrations.length === 0) {
  console.error("Usage: node scripts/apply-migration.mjs <migration.sql> [...]");
  process.exit(2);
}

const pool = new Pool({
  host: process.env.DATABASE_HOST || "127.0.0.1",
  port: parseInt(process.env.DATABASE_PORT || "5432"),
  user: process.env.DATABASE_USER || "citymarket_user",
  password: process.env.DATABASE_PASSWORD || "",
  database: process.env.DATABASE_NAME || "citymarket_db",
});

async function ensureTrackingTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_migrations (
      id SERIAL PRIMARY KEY,
      filename TEXT UNIQUE NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      checksum TEXT NOT NULL
    )
  `);
}

async function isApplied(filename) {
  const r = await pool.query("SELECT 1 FROM app_migrations WHERE filename = $1", [filename]);
  return r.rows.length > 0;
}

(async () => {
  await ensureTrackingTable();
  for (const filename of migrations) {
    if (await isApplied(filename)) {
      console.log(`[SKIP] ${filename} — already applied`);
      continue;
    }
    const sql = readFileSync(`migrations/${filename}`, "utf8");
    console.log(`[APPLY] ${filename}`);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query(
        "INSERT INTO app_migrations (filename, checksum) VALUES ($1, $2) ON CONFLICT (filename) DO NOTHING",
        [filename, "manual-apply"]
      );
      await client.query("COMMIT");
      console.log(`[OK]    ${filename}`);
    } catch (e) {
      await client.query("ROLLBACK");
      console.error(`[FAIL]  ${filename}: ${e.message}`);
      process.exit(1);
    } finally {
      client.release();
    }
  }
  await pool.end();
})().catch((e) => {
  console.error("FATAL:", e.message);
  process.exit(1);
});