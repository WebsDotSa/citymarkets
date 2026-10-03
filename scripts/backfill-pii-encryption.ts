#!/usr/bin/env tsx
/**
 * Backfill PII encryption columns.
 *
 * P0-3 (security Phase 3, 2026-10-03) added the `*_encrypted` and
 * `*_hmac` columns (migration 121). P0-PII-KMS (security Phase 5,
 * 2026-10-03) replaced the single-key scheme with envelope
 * encryption. This backfill now writes envelope-format ciphertext
 * (prefix byte 0x01) and uses the HMAC key derived from the active
 * DEK — i.e. the new format produced by src/lib/security/pii-crypto.ts
 * encryptPii.
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
 *   PII_MASTER_KEY  base64 32-byte KEK (AES-256-KW key)
 *   PII_DATA_KEY    base64 40-byte wrapped DEK (AES-256-KW output)
 *   PII_ENCRYPTION_KEY  base64 32-byte legacy KEK (only needed while
 *                        any legacy rows remain; can be dropped once
 *                        the backfill reports zero rows)
 *   PII_HMAC_KEY    base64 32-byte legacy HMAC key (same caveat as
 *                    PII_ENCRYPTION_KEY)
 *
 *   PII_MASTER_KEY + PII_DATA_KEY MUST match what the running app
 *   uses. If they are rotated while a backfill is in flight, the
 *   app will fail to decrypt the new rows it reads. Run a backfill
 *   to completion before rotating keys; or run two backfills (one
 *   before, one after) with the corresponding keys.
 *
 *   The legacy env vars (PII_ENCRYPTION_KEY, PII_HMAC_KEY) are read
 *   ONLY to recompute the legacy HMAC on rows whose hmac column is
 *   still the legacy hash. New rows are written with the active
 *   HMAC key (derived from the DEK). Once the legacy path stops
 *   reading these env vars, the operator can drop them.
 *
 * What it does
 * ------------
 * For each affected table (users, drivers, addresses, orders), this
 * script:
 *   1. SELECTs up to <batch-size> rows where the encrypted column
 *      IS NULL AND the plaintext column IS NOT NULL.
 *   2. Computes envelope-format ciphertext + active HMAC for each
 *      row.
 *   3. UPDATEs the row in a single statement per row (so a single
 *      bad row doesn't poison the whole batch).
 *   4. Sleeps briefly between batches.
 *   5. Repeats until no more rows need updating.
 *
 * Idempotency
 * -----------
 * Rows that already have an encrypted value are skipped. Rows
 * encrypted by the legacy P0-3 scheme (no version byte) are NOT
 * re-encrypted by this script — the legacy decrypt path still
 * works because the legacy KEK is in env. To re-encrypt legacy
 * rows under the new envelope scheme, the operator must run a
 * follow-up migration that flips the whereSql from
 * `col IS NULL` to `col NOT LIKE 'e0%'` (Phase 6 work, separate).
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
import {
  randomBytes,
  createCipheriv,
  createDecipheriv,
  createHmac,
  hkdfSync,
} from "node:crypto";
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

const PII_MASTER_KEY = requireEnv("PII_MASTER_KEY");
const PII_DATA_KEY = requireEnv("PII_DATA_KEY");
const PII_ENCRYPTION_KEY = process.env.PII_ENCRYPTION_KEY; // legacy, optional
const PII_HMAC_KEY = process.env.PII_HMAC_KEY; // legacy, optional

// ── AES-256-KW (RFC 3394, mirrors src/lib/security/pii-crypto.ts) ──
const AES_KW_DEFAULT_IV = Buffer.from("a6a6a6a6a6a6a6a6", "hex");

function aesEcb(key: Buffer, block: Buffer): Buffer {
  const c = createCipheriv("aes-256-ecb", key, Buffer.alloc(0));
  c.setAutoPadding(false);
  return Buffer.concat([c.update(block), c.final()]);
}

function aesKeyUnwrap(kek: Buffer, wrapped: Buffer): Buffer {
  if (wrapped.length % 8 !== 0 || wrapped.length < 16) {
    throw new Error(`AES-KW wrapped input invalid: length ${wrapped.length}`);
  }
  const n = wrapped.length / 8 - 1;
  let A = Buffer.from(wrapped.subarray(0, 8));
  const R: Buffer[] = [];
  for (let i = 0; i < n; i++) {
    R.push(Buffer.from(wrapped.subarray(8 + i * 8, 8 + (i + 1) * 8)));
  }
  for (let j = 5; j >= 0; j--) {
    for (let i = n; i >= 1; i--) {
      const counter = Buffer.alloc(8);
      counter.writeUInt32BE(n * j + i, 4);
      const Ainv = Buffer.alloc(8);
      for (let k = 0; k < 8; k++) Ainv[k] = A[k] ^ counter[k];
      const d = createDecipheriv("aes-256-ecb", kek, Buffer.alloc(0));
      d.setAutoPadding(false);
      const B = Buffer.concat([
        d.update(Buffer.concat([Ainv, R[i - 1]])),
        d.final(),
      ]);
      A = Buffer.from(B.subarray(0, 8));
      R[i - 1] = B.subarray(8);
    }
  }
  if (!A.equals(AES_KW_DEFAULT_IV)) {
    throw new Error("AES-KW integrity check failed");
  }
  return Buffer.concat(R);
}

const KEK = Buffer.from(PII_MASTER_KEY, "base64");
if (KEK.length !== 32) {
  console.error(`[fatal] PII_MASTER_KEY must decode to exactly 32 bytes (got ${KEK.length}).`);
  process.exit(2);
}
const DEK = aesKeyUnwrap(KEK, Buffer.from(PII_DATA_KEY, "base64"));
if (DEK.length !== 32) {
  console.error(`[fatal] Unwrapped DEK is not 32 bytes (got ${DEK.length}). Check PII_DATA_KEY.`);
  process.exit(2);
}

// ── AES-256-GCM (envelope scheme, mirrors src/lib/security/pii-crypto.ts) ──
const ALGO = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;
const VERSION_ENVELOPE = 0x01;
const ACTIVE_DEK_VERSION = 0x01;
const HMAC_INFO = "citymarkets-pii-hmac-v1";
const DEK_INFO_LEGACY = "citymarkets-pii-dek-v1";

const ACTIVE_HMAC_KEY = Buffer.from(
  hkdfSync("sha256", DEK, Buffer.alloc(0), Buffer.from(HMAC_INFO), KEY_BYTES),
);

// Legacy HMAC key, used only to read phone_hmac columns written by
// the P0-3 backfill. Optional — absent if the operator already
// rotated away from P0-3.
const LEGACY_HMAC_KEY = PII_HMAC_KEY
  ? Buffer.from(
      hkdfSync(
        "sha256",
        Buffer.from(PII_HMAC_KEY, "base64"),
        Buffer.alloc(0),
        Buffer.from(HMAC_INFO),
        KEY_BYTES,
      ),
    )
  : null;
const LEGACY_DEK = PII_ENCRYPTION_KEY
  ? Buffer.from(
      hkdfSync(
        "sha256",
        Buffer.from(PII_ENCRYPTION_KEY, "base64"),
        Buffer.alloc(0),
        Buffer.from(DEK_INFO_LEGACY),
        KEY_BYTES,
      ),
    )
  : null;

function normalisePhone(phone: string): string {
  const trimmed = phone.trim();
  const hasPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");
  if (!digits) return "";
  return hasPlus ? `+${digits}` : digits;
}

function encrypt(plaintext: string): string {
  // Envelope format: 0x01 || dek_version || iv(12) || ct || tag(16)
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, DEK, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([
    Buffer.from([VERSION_ENVELOPE, ACTIVE_DEK_VERSION]),
    iv,
    ct,
    tag,
  ]).toString("base64");
}

function encryptLegacy(plaintext: string): string {
  // Legacy P0-3 format: iv(12) || ct || tag(16). Used only if a row
  // already has a *_encrypted value in legacy format and we need to
  // preserve it on re-write (e.g. when only the HMAC needs updating).
  if (!LEGACY_DEK) {
    throw new Error(
      "PII_ENCRYPTION_KEY is not set; cannot write legacy-format ciphertext.",
    );
  }
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, LEGACY_DEK, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, ct, tag]).toString("base64");
}

function hmac(plaintext: string): string {
  // Active HMAC key — derived from the DEK, used for new writes
  // (and for any row whose hmac column was never set).
  const normalised = normalisePhone(plaintext);
  const input = normalised || plaintext.trim().toLowerCase();
  return createHmac("sha256", ACTIVE_HMAC_KEY).update(input, "utf8").digest("base64");
}

function hmacLegacy(plaintext: string): string {
  if (!LEGACY_HMAC_KEY) {
    throw new Error(
      "PII_HMAC_KEY is not set; cannot write legacy-format HMAC.",
    );
  }
  const normalised = normalisePhone(plaintext);
  const input = normalised || plaintext.trim().toLowerCase();
  return createHmac("sha256", LEGACY_HMAC_KEY).update(input, "utf8").digest("base64");
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
