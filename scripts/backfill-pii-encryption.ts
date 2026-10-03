#!/usr/bin/env tsx
/**
 * Backfill PII encryption columns.
 *
 * P0-3 (security Phase 3, 2026-10-03): migrates existing rows from
 * plaintext PII columns to the new `*_encrypted` and `*_hmac`
 * columns added by migration 121. Idempotent: rows that already
 * have an `_encrypted` value are skipped.
 *
 * Usage:
 *   # Dry-run (default): print what would be updated, change nothing.
 *   tsx scripts/backfill-pii-encryption.ts
 *
 *   # Apply. Batches of 500 rows per commit, sleeps 100ms between
 *   # batches to keep the table from being locked for long.
 *   tsx scripts/backfill-pii-encryption.ts --apply
 *
 *   # Limit the work (e.g. for staging verification).
 *   tsx scripts/backfill-pii-encryption.ts --apply --limit=100
 *
 * Required env:
 *   PII_ENCRYPTION_KEY  base64 32-byte key, same one the app uses
 *   PII_HMAC_KEY        base64 32-byte key, same one the app uses
 *
 *   These MUST be the keys the running app uses. If the app's keys
 *   are rotated while a backfill is in flight, the app will fail to
 *   decrypt the new rows it reads. Run a backfill to completion
 *   before rotating keys; or run two backfills (one before, one
 *   after) with the corresponding keys.
 *
 * What it does
 * ------------
 * For each affected table (users, drivers, addresses, orders), this
 * script:
 *   1. SELECTs up to <batch-size> rows where the encrypted column
 *      IS NULL AND the plaintext column IS NOT NULL.
 *   2. Computes ciphertext + (where applicable) HMAC for each row.
 *   3. UPDATEs the row in a single statement per row (so a single
 *      bad row doesn't poison the whole batch).
 *   4. Sleeps briefly between batches.
 *   5. Repeats until no more rows need updating.
 *
 * Output
 * ------
 *   Per-batch log line: "[backfill] users 500/12450 (+500, 0 errors)".
 *   Final summary: total rows updated per table, total errors, total
 *   elapsed time.
 *
 * Exit codes
 * ----------
 *   0   success (even if zero rows needed updating)
 *   1   one or more rows failed to update; see the error summary
 *   2   could not connect / missing env / configuration error
 */

import { Client } from "pg";
import { randomBytes } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "..");

// ── env loader (mirrors scripts/migration-diagnostics.ts) ──
function loadEnv(): void {
  for (const f of [".env.local", ".env"]) {
    const p = join(REPO_ROOT, f);
    if (!existsSync(p)) continue;
    const txt = readFileSync(p, "utf8");
    for (const line of txt.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq < 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let val = trimmed.slice(eq + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (!(key in process.env)) process.env[key] = val;
    }
  }
}
loadEnv();

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`[fatal] ${name} is not set. Refusing to run.`);
    process.exit(2);
  }
  return v;
}

const PII_ENCRYPTION_KEY = requireEnv("PII_ENCRYPTION_KEY");
const PII_HMAC_KEY = requireEnv("PII_HMAC_KEY");

// ── AES-256-GCM (mirrors src/lib/security/pii-crypto.ts) ──
import { createCipheriv, createHmac, hkdfSync } from "node:crypto";

const ALGO = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;
const DEK_INFO = "citymarkets-pii-dek-v1";
const HMAC_INFO = "citymarkets-pii-hmac-v1";

const dek = Buffer.from(
  hkdfSync(
    "sha256",
    Buffer.from(PII_ENCRYPTION_KEY, "base64"),
    Buffer.alloc(0),
    Buffer.from(DEK_INFO),
    KEY_BYTES,
  ),
);
const hmacKey = Buffer.from(
  hkdfSync(
    "sha256",
    Buffer.from(PII_HMAC_KEY, "base64"),
    Buffer.alloc(0),
    Buffer.from(HMAC_INFO),
    KEY_BYTES,
  ),
);

function normalisePhone(phone: string): string {
  const trimmed = phone.trim();
  const hasPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");
  if (!digits) return "";
  return hasPlus ? `+${digits}` : digits;
}

function encrypt(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, dek, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, ct, tag]).toString("base64");
}

function hmac(plaintext: string): string {
  const normalised = normalisePhone(plaintext);
  const input = normalised || plaintext.trim().toLowerCase();
  return createHmac("sha256", hmacKey).update(input, "utf8").digest("base64");
}

// ── CLI args ──
function arg(flag: string, dflt: string): string {
  const i = process.argv.indexOf(flag);
  if (i >= 0 && i + 1 < process.argv.length) return process.argv[i + 1];
  return dflt;
}
const APPLY = process.argv.includes("--apply");
const LIMIT = parseInt(arg("--limit", "0"), 10);
const BATCH_SIZE = Math.min(parseInt(arg("--batch-size", "500"), 10), 5000);

if (!APPLY) {
  console.log(
    "[dry-run] Pass --apply to actually update rows. No changes will be made.",
  );
}

// ── per-table backfill plan ──
type Row = Record<string, unknown> & { id: string };

interface TablePlan {
  table: string;
  // columns we update on every row
  columns: { encrypted: string; hmac?: string; plaintext: string }[];
  // where-clause to select rows that still need backfill
  whereSql: string;
  // how to compute the update payload for one row
  compute: (row: Row) => Record<string, string>;
}

const PLANS: TablePlan[] = [
  {
    table: "users",
    whereSql:
      "phone_encrypted IS NULL AND phone IS NOT NULL",
    columns: [
      { encrypted: "phone_encrypted", hmac: "phone_hmac", plaintext: "phone" },
      { encrypted: "name_encrypted", plaintext: "name" },
      { encrypted: "email_encrypted", plaintext: "email" },
    ],
    compute: (row) => {
      const phoneDb = normalisePhone(String(row.phone ?? ""));
      return {
        phone_encrypted: encrypt(phoneDb),
        phone_hmac: hmac(phoneDb),
        name_encrypted: row.name ? encrypt(String(row.name)) : null as unknown as string,
        email_encrypted: row.email ? encrypt(String(row.email)) : null as unknown as string,
      } as Record<string, string>;
    },
  },
  {
    table: "drivers",
    whereSql: "phone_encrypted IS NULL AND phone IS NOT NULL",
    columns: [
      { encrypted: "phone_encrypted", hmac: "phone_hmac", plaintext: "phone" },
      { encrypted: "name_encrypted", plaintext: "name" },
    ],
    compute: (row) => {
      const phoneDb = normalisePhone(String(row.phone ?? ""));
      return {
        phone_encrypted: encrypt(phoneDb),
        phone_hmac: hmac(phoneDb),
        name_encrypted: row.name ? encrypt(String(row.name)) : null as unknown as string,
      } as Record<string, string>;
    },
  },
  {
    table: "addresses",
    whereSql: "address_text_encrypted IS NULL AND address_text IS NOT NULL",
    columns: [
      { encrypted: "address_text_encrypted", plaintext: "address_text" },
      { encrypted: "label_encrypted", plaintext: "label" },
    ],
    compute: (row) => ({
      address_text_encrypted: encrypt(String(row.address_text ?? "")),
      label_encrypted: row.label ? encrypt(String(row.label)) : null as unknown as string,
    } as Record<string, string>),
  },
  {
    table: "orders",
    whereSql: "guest_phone_encrypted IS NULL AND guest_phone IS NOT NULL",
    columns: [
      { encrypted: "guest_phone_encrypted", plaintext: "guest_phone" },
      { encrypted: "guest_name_encrypted", plaintext: "guest_name" },
    ],
    compute: (row) => ({
      guest_phone_encrypted: encrypt(String(row.guest_phone ?? "")),
      guest_name_encrypted: row.guest_name ? encrypt(String(row.guest_name)) : null as unknown as string,
    } as Record<string, string>),
  },
];

// ── runner ──
async function main(): Promise<void> {
  const client = new Client({
    host: process.env.DATABASE_HOST,
    port: parseInt(process.env.DATABASE_PORT || "5432", 10),
    database: process.env.DATABASE_NAME,
    user: process.env.DATABASE_USER,
    password: process.env.DATABASE_PASSWORD,
    ssl:
      process.env.DATABASE_SSL === "true"
        ? { rejectUnauthorized: false }
        : undefined,
  });
  await client.connect();

  const startedAt = Date.now();
  let grandTotal = 0;
  let grandErrors = 0;

  for (const plan of PLANS) {
    let tableTotal = 0;
    let tableErrors = 0;
    let batch: Row[] = [];
    console.log(`[backfill] ${plan.table} starting (where: ${plan.whereSql})`);

    while (true) {
      const remaining =
        LIMIT > 0 ? Math.max(0, LIMIT - tableTotal) : BATCH_SIZE;
      if (LIMIT > 0 && remaining === 0) break;
      const batchSize = Math.min(BATCH_SIZE, remaining);

      const r = await client.query<Row>(
        `SELECT id, ${plan.columns
          .map((c) => c.plaintext)
          .join(", ")} FROM ${plan.table}
          WHERE ${plan.whereSql}
          ORDER BY id
          LIMIT $1`,
        [batchSize],
      );
      batch = r.rows;
      if (batch.length === 0) break;

      if (!APPLY) {
        tableTotal += batch.length;
        console.log(
          `[dry-run] ${plan.table} would update ${batch.length} rows (total ${tableTotal})`,
        );
        break; // single pass in dry-run
      }

      for (const row of batch) {
        try {
          const payload = plan.compute(row);
          // Filter out nulls so the UPDATE only touches non-null columns
          // (otherwise we'd write NULL over a previously-set value).
          const setClauses: string[] = [];
          const params: unknown[] = [];
          let p = 1;
          for (const [k, v] of Object.entries(payload)) {
            if (v == null) continue;
            setClauses.push(`${k} = $${p++}`);
            params.push(v);
          }
          if (setClauses.length === 0) {
            tableErrors++;
            continue;
          }
          params.push(row.id);
          await client.query(
            `UPDATE ${plan.table} SET ${setClauses.join(", ")} WHERE id = $${p}`,
            params,
          );
          tableTotal++;
        } catch (err) {
          tableErrors++;
          console.error(
            `[backfill] ${plan.table} id=${row.id} failed: ${(err as Error).message}`,
          );
        }
      }
      console.log(
        `[backfill] ${plan.table} ${tableTotal} (${tableErrors} errors so far)`,
      );

      // Yield to the DB between batches. 100ms is short enough to
      // keep total backfill time reasonable but long enough that
      // other queries (logins, profile reads) are not starved.
      await new Promise((r) => setTimeout(r, 100));
    }

    grandTotal += tableTotal;
    grandErrors += tableErrors;
    console.log(
      `[backfill] ${plan.table} done: ${tableTotal} rows, ${tableErrors} errors`,
    );
  }

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(
    `[backfill] finished in ${elapsed}s. ${grandTotal} rows updated, ${grandErrors} errors.`,
  );

  await client.end();
  process.exit(grandErrors > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("[fatal]", err);
  process.exit(2);
});
