#!/usr/bin/env tsx
/**
 * Generate a new PII data encryption key (DEK) and wrap it with the
 * master key (KEK) using AES-256-KW.
 *
 * P0-PII-KMS (security Phase 5, 2026-10-03): envelope encryption.
 * See src/lib/security/pii-crypto.ts and
 * docs/security/pii-encryption.md for the algorithm and the
 * upgrade path to a real KMS.
 *
 * What it does
 * ------------
 *   1. Reads PII_MASTER_KEY from env (32 random bytes, base64).
 *   2. Generates a fresh 32-byte DEK using a CSPRNG.
 *   3. Wraps the DEK with the KEK using AES-256-KW (RFC 3394).
 *   4. Computes a KEK fingerprint = SHA-256(KEK), first 16 hex
 *      chars. The fingerprint is safe to log and to commit to the
 *      `pii_keys` table; the KEK itself is not.
 *   5. Prints:
 *        - The wrapped DEK (base64) — set this as PII_DATA_KEY in
 *          env so the app can boot before the DB is reachable.
 *        - The KEK fingerprint — verify it matches the value
 *          printed by other deployments that share the same KEK.
 *        - A SQL INSERT statement to seed the pii_keys table.
 *
 * Usage
 * -----
 *   tsx scripts/generate-pii-dek.ts
 *
 *   # Optional label and KEK-fingerprint sanity check
 *   tsx scripts/generate-pii-dek.ts --label="phase5-prod-2026-10-03"
 *
 * The script never writes to disk or to the database. The operator
 * copies the SQL into psql and the wrapped-DEK into env. Both are
 * safe to commit to version control: the wrapped DEK is useless
 * without the KEK, and the fingerprint is just a SHA-256 prefix.
 *
 * Security notes
 * --------------
 *   - Run this script ONCE per environment, on a host the secrets
 *     manager trusts. Re-running produces a new DEK; the old one
 *     becomes useless for new writes but is still needed to
 *     decrypt historical ciphertexts (which carry the version
 *     byte).
 *   - The DEK is generated in memory and printed; it is never
 *     persisted anywhere in plaintext. The wrapped form is the
 *     only persistent representation.
 *   - Generating a DEK does not require DB access — the script
 *     only needs PII_MASTER_KEY from env.
 *
 * Exit codes
 * ----------
 *   0   success — wrapped DEK, fingerprint, and SQL printed.
 *   2   missing or malformed PII_MASTER_KEY in env.
 */

import { randomBytes, createHash, createCipheriv } from "node:crypto";

const KEK_ENV = "PII_MASTER_KEY";
const KEY_BYTES = 32;

function readKek(): Buffer {
  const v = process.env[KEK_ENV];
  if (!v) {
    console.error(`[fatal] ${KEK_ENV} is not set.`);
    console.error(
      `        Generate one with: node -e "console.log(require('crypto').randomBytes(${KEY_BYTES}).toString('base64'))"`,
    );
    process.exit(2);
  }
  const buf = Buffer.from(v, "base64");
  if (buf.length !== KEY_BYTES) {
    console.error(
      `[fatal] ${KEK_ENV} must decode to exactly ${KEY_BYTES} bytes (got ${buf.length}).`,
    );
    console.error(
      `        Generate a fresh one with: node -e "console.log(require('crypto').randomBytes(${KEY_BYTES}).toString('base64'))"`,
    );
    process.exit(2);
  }
  return buf;
}

// AES-256-KW (RFC 3394). Inlined here rather than imported from
// src/lib/security/pii-crypto.ts so this script has no dependency
// on the application code (and so it can run in environments that
// haven't built the application yet, e.g. a clean container during
// initial deployment).
const AES_KW_DEFAULT_IV = Buffer.from("a6a6a6a6a6a6a6a6", "hex");

function aesEcb(key: Buffer, block: Buffer): Buffer {
  const c = createCipheriv("aes-256-ecb", key, Buffer.alloc(0));
  c.setAutoPadding(false);
  return Buffer.concat([c.update(block), c.final()]);
}

function aesKeyWrap(kek: Buffer, dek: Buffer): Buffer {
  const n = dek.length / 8;
  let A = Buffer.from(AES_KW_DEFAULT_IV);
  const R: Buffer[] = [];
  for (let i = 0; i < n; i++) {
    R.push(Buffer.from(dek.subarray(i * 8, (i + 1) * 8)));
  }
  for (let j = 0; j <= 5; j++) {
    for (let i = 1; i <= n; i++) {
      const B = aesEcb(kek, Buffer.concat([A, R[i - 1]]));
      const t = Buffer.alloc(8);
      const counter = Buffer.alloc(8);
      counter.writeUInt32BE(n * j + i, 4);
      for (let k = 0; k < 8; k++) t[k] = B[k] ^ counter[k];
      A = Buffer.from(t);
      R[i - 1] = B.subarray(8);
    }
  }
  return Buffer.concat([A, ...R]);
}

function fingerprint(kek: Buffer): string {
  return createHash("sha256").update(kek).digest("hex").slice(0, 16);
}

function parseArgs(argv: string[]): { label: string | null } {
  let parsedLabel: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--label" && i + 1 < argv.length) {
      parsedLabel = argv[i + 1];
      i++;
    } else if (argv[i].startsWith("--label=")) {
      parsedLabel = argv[i].slice("--label=".length);
    }
  }
  return { label: parsedLabel };
}

function main(): void {
  const { label } = parseArgs(process.argv.slice(2));
  const kek = readKek();
  const dek = randomBytes(KEY_BYTES);
  const wrapped = aesKeyWrap(kek, dek);
  const fp = fingerprint(kek);
  const wrappedB64 = wrapped.toString("base64");
  const labelSql = label ? `'${label.replace(/'/g, "''")}'` : "NULL";

  console.log("");
  console.log("PII data encryption key generated (Phase 5 envelope).");
  console.log("");
  console.log("=== PII_DATA_KEY (env var) ===");
  console.log(wrappedB64);
  console.log("");
  console.log("=== KEK fingerprint (verification only, safe to log) ===");
  console.log(fp);
  console.log("");
  console.log("=== SQL — seed the pii_keys table ===");
  console.log(
    `INSERT INTO pii_keys (key_version, wrapped_dek, kek_fingerprint, label, is_active)\n` +
      `VALUES (1, '${wrappedB64}', '${fp}', ${labelSql}, true)\n` +
      `ON CONFLICT (key_version) DO UPDATE SET\n` +
      `  wrapped_dek = EXCLUDED.wrapped_dek,\n` +
      `  kek_fingerprint = EXCLUDED.kek_fingerprint,\n` +
      `  label = EXCLUDED.label,\n` +
      `  is_active = EXCLUDED.is_active;`,
  );
  console.log("");
  console.log(
    "Set PII_DATA_KEY in every app + worker env, then run the SQL above.",
  );
  console.log(
    "The DEK itself is not printed anywhere. Losing PII_MASTER_KEY",
  );
  console.log(
    "renders every wrapped DEK (including this one) unrecoverable.",
  );
}

main();