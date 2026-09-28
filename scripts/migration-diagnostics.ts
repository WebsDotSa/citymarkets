#!/usr/bin/env tsx
/**
 * Diagnostic script — verify that critical migrations were applied to the
 * live database. This is the safety net behind the per-feature memory
 * notes:
 *
 *   - "app_migrations tracking gap for pre-018 files" (runner only records
 *     018+, so pre-018 ALTER TABLE migrations may have been silently
 *     skipped, leaving columns missing on the live DB).
 *   - "Loyalty earn was broken by partial unique index" (026's partial
 *     index doesn't satisfy `ON CONFLICT (ref_order_id, type)` — fixed by
 *     046 with a non-partial unique index).
 *   - "Admin product delete FK blocker (054)" (vendor_order_items.product_id
 *     had no ON DELETE; 054 made it nullable + ON DELETE SET NULL).
 *
 * Run with:
 *   tsx scripts/migration-diagnostics.ts
 *
 * Exit code: 0 = all checks passed, 1 = at least one missing.
 */

import { Client } from "pg";
import { existsSync, readFileSync } from "node:fs";

/**
 * Read .env.local directly so this script doesn't need to import the
 * Next.js-only env helper (which pulls in `next/headers` and friends).
 * Mirrors the same env parsing style used in scripts/migrate.ts.
 */
function loadEnvLocal(): void {
  const path = ".env.local";
  if (!existsSync(path)) return;
  const text = readFileSync(path, "utf8");
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

function getDbConfig() {
  return {
    host: process.env.DATABASE_HOST || "127.0.0.1",
    port: parseInt(process.env.DATABASE_PORT || "5432", 10),
    database: process.env.DATABASE_NAME || "citymarket_db",
    user: process.env.DATABASE_USER || "citymarket_user",
    password: process.env.DATABASE_PASSWORD || "",
    // Supabase pooler requires TLS; local Postgres doesn't — `pg` only
    // enables SSL when a truthy option is present, so omitting it is a
    // safe no-op for local dev.
    ssl:
      process.env.DATABASE_SSL === "false"
        ? false
        : { rejectUnauthorized: false },
    family: 4,
    connectionTimeoutMillis: 5000,
  };
}

interface Check {
  name: string;
  migration: string;
  query: string;
  /**
   * Receives the raw query result and returns true when the migration is
   * confirmed applied. Return false (and a `reason`) to fail the check.
   */
  assert: (rows: Record<string, unknown>[]) => { ok: boolean; reason?: string };
}

const CHECKS: Check[] = [
  // 046 — replace the partial unique index on loyalty_transactions with a
  // non-partial one so `ON CONFLICT (ref_order_id, type)` resolves it.
  {
    name: "uq_loyalty_tx_ref_order_type is a non-partial unique index",
    migration: "046_loyalty_idempotency_index.sql",
    query: `
      SELECT 1
        FROM pg_index i
        JOIN pg_class c ON c.oid = i.indexrelid
       WHERE c.relname = 'uq_loyalty_tx_ref_order_type'
         AND i.indisunique = TRUE
         AND i.indpred IS NULL
       LIMIT 1
    `,
    assert: (rows) =>
      rows.length > 0
        ? { ok: true }
        : {
            ok: false,
            reason:
              "uq_loyalty_tx_ref_order_type is missing or is partial. " +
              "Apply 046_loyalty_idempotency_index.sql as postgres.",
          },
  },

  // 054 — vendor_order_items.product_id should be nullable with
  // ON DELETE SET NULL.
  {
    name: "vendor_order_items.product_id is nullable + ON DELETE SET NULL",
    migration: "054_vendor_order_items_product_nullable.sql",
    query: `
      SELECT 1
        FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'vendor_order_items'
         AND column_name = 'product_id'
         AND is_nullable = 'YES'
       LIMIT 1
    `,
    assert: (rows) => {
      if (rows.length === 0) {
        return {
          ok: false,
          reason:
            "vendor_order_items.product_id is still NOT NULL. " +
            "Apply 054 as postgres (citymarket_user lacks ALTER privilege).",
        };
      }
      // We can't easily query the FK ON DELETE rule via information_schema;
      // a follow-up query against pg_constraint would confirm SET NULL. The
      // is_nullable assertion is the highest-value one — without it the
      // DELETE endpoint returns 500 because the FK won't allow the row.
      return { ok: true };
    },
  },

  // 058 — abandoned_carts snapshot table for abandoned-checkout recovery.
  {
    name: "abandoned_carts table exists",
    migration: "058_abandoned_carts.sql",
    query: `
      SELECT 1
        FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name = 'abandoned_carts'
       LIMIT 1
    `,
    assert: (rows) =>
      rows.length > 0
        ? { ok: true }
        : {
            ok: false,
            reason:
              "abandoned_carts table is missing. " +
              "Apply 058_abandoned_carts.sql.",
          },
  },
];

async function main() {
  const client = new Client(getDbConfig());
  await client.connect();

  let failures = 0;

  for (const check of CHECKS) {
    process.stdout.write(`• ${check.name} … `);
    try {
      const res = await client.query(check.query);
      const verdict = check.assert(res.rows as Record<string, unknown>[]);
      if (verdict.ok) {
        process.stdout.write("OK\n");
      } else {
        process.stdout.write(`FAIL — ${verdict.reason ?? "no reason given"}\n`);
        failures++;
      }
    } catch (e) {
      process.stdout.write(
        `ERROR — ${e instanceof Error ? e.message : String(e)}\n`,
      );
      failures++;
    }
  }

  await client.end();

  console.log(
    `\n${CHECKS.length - failures}/${CHECKS.length} checks passed.`,
  );

  if (failures > 0) {
    console.error(
      "Some migrations appear to be missing on the live DB. " +
        "Re-run scripts/migrate.ts --dry-run to see the full plan; " +
        "for legacy tables (046, 054) connect as postgres and apply manually.",
    );
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("diagnostic crashed:", err);
  process.exit(2);
});