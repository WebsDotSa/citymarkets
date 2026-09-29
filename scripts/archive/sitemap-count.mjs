#!/usr/bin/env node
/**
 * Count URLs that will appear in /sitemap.xml (requires DB).
 * Usage: node scripts/sitemap-count.mjs
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pkg from "pg";

const { Pool } = pkg;
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

function loadEnvLocal() {
  const p = join(ROOT, ".env.local");
  if (!existsSync(p)) return;
  for (const raw of readFileSync(p, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}

loadEnvLocal();

const pool = new Pool({
  host: process.env.DATABASE_HOST || "localhost",
  port: parseInt(process.env.DATABASE_PORT || "5432", 10),
  database: process.env.DATABASE_NAME || "citymarket_db",
  user: process.env.DATABASE_USER || "citymarket_user",
  password:
    process.env.DATABASE_PASSWORD ||
    "city-market-dev-database-password-only",
});

const STATIC = 10;

async function main() {
  const cat = await pool.query(
    `SELECT COUNT(*)::int AS n FROM categories WHERE slug IS NOT NULL AND TRIM(slug) <> ''`
  );
  const prod = await pool.query(
    `SELECT COUNT(*)::int AS n FROM products WHERE is_active = true`
  );
  const categories = cat.rows[0].n;
  const products = prod.rows[0].n;
  const total = STATIC + categories + products;
  console.log(`Sitemap estimate: ${total} URLs`);
  console.log(`  static pages: ${STATIC}`);
  console.log(`  category catalog URLs: ${categories}`);
  console.log(`  product pages: ${products}`);
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
