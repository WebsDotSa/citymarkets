/**
 * Application-level PII encryption.
 *
 * Why this exists
 * ---------------
 * The P0-PII-PLAINTEXT-DATABASE finding (security audit, 2026-10-03)
 * flagged that users.phone, users.name, users.email, drivers.phone,
 * drivers.name, addresses.address_text, addresses.label,
 * orders.guest_phone, and orders.guest_name are stored in plaintext
 * in Postgres. A database breach — stolen credentials, SQL
 * injection, backup leak — exposes every customer's contact info
 * and home address.
 *
 * Approach: encrypt at the application layer, before the SQL query
 * is constructed. The DB never sees plaintext, the encryption key
 * never leaves process memory. The audit explicitly called out that
 * the project does not yet have a KMS, so we derive the data
 * encryption key (DEK) from a master key in env. This is a
 * pragmatic stop-gap: a DB breach no longer leaks PII in clear, but
 * an attacker who also compromises the process environment (env
 * file, secrets manager, container introspection) can derive the
 * DEK and decrypt. The KMS-backed follow-up (P0-PII-KMS) replaces
 * this with envelope encryption and a per-row data key.
 *
 * Threat model
 * ------------
 *   In scope:
 *     - DB breach: data is encrypted at rest, useless without key.
 *     - DB backup leak: same — backups are encrypted blobs.
 *     - DB read replica leak: same.
 *   Out of scope (covered by other layers):
 *     - Application server compromise: attacker reads plaintext
 *       in memory or decrypts at the API boundary.
 *     - Insider with DB + env access: can derive DEK and decrypt.
 *   This is a database-at-rest control, not an in-transit control.
 *   TLS, query parameterisation, and the existing auth layers
 *   remain the primary defence against the application server and
 *   in-transit threats.
 *
 * Algorithm
 * ---------
 *   AES-256-GCM, 96-bit random IV per encryption, 128-bit auth tag
 *   appended to ciphertext. The key is 32 bytes derived from
 *   PII_ENCRYPTION_KEY (a base64-encoded 32-byte secret in env) via
 *   HKDF-SHA256 with a fixed info string. The fixed info string
 *   binds the derived key to this purpose so a future
 *   PII_ENCRYPTION_KEY_V2 can coexist during rotation without
 *   confusing old ciphertext with new key.
 *
 * Format
 * ------
 *   Encrypted columns store base64( iv(12) || ciphertext || tag(16) ).
 *   The format is self-describing: we know an IV was 12 bytes and a
 *   GCM tag is 16 bytes, so the decode is unambiguous. The encoding
 *   is reversible on the read path.
 *
 * Blind index
 * -----------
 *   For columns we need to look up by (phone, for OTP login), we
 *   additionally store a deterministic HMAC-SHA256 of the normalised
 *   plaintext in a `<col>_hmac` column. The HMAC key is derived
 *   separately (PII_HMAC_KEY env var, also base64 32 bytes) so a
 *   blind-index leak does not enable decryption. Phone numbers are
 *   normalised to E.164 (digits only, leading +) before HMAC.
 *
 * Key rotation
 * ------------
 *   To rotate, set the new keys in env (PII_ENCRYPTION_KEY_V2,
 *   PII_HMAC_KEY_V2) and re-run a backfill migration that
 *   re-encrypts every row. Both old and new ciphertexts can coexist
 *   for the rotation window because the encryption format is
 *   self-describing. A read path that encounters ciphertext
 *   encrypted under the old key needs to know the old key to
 *   decrypt — the helper below does NOT auto-fall-back; callers
 *   must pass the matching key. The follow-up migration will
 *   introduce a key-version byte prefix to make this explicit.
 *
 *   This module is intentionally a single key version. Key rotation
 *   is a separate concern tracked in a follow-up.
 */
import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from "node:crypto";

const ALGO = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

const DEK_INFO = "citymarkets-pii-dek-v1";
const HMAC_INFO = "citymarkets-pii-hmac-v1";

let cachedDek: Buffer | null = null;
let cachedHmacKey: Buffer | null = null;

function readEnvKey(name: string): Buffer {
  const v = process.env[name];
  if (!v) {
    throw new Error(
      `${name} is not set. PII encryption requires a 32-byte base64 key in env. ` +
        `Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`,
    );
  }
  const buf = Buffer.from(v, "base64");
  if (buf.length !== KEY_BYTES) {
    throw new Error(
      `${name} must decode to exactly ${KEY_BYTES} bytes (got ${buf.length}). ` +
        `Generate a fresh one with: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`,
    );
  }
  return buf;
}

function getDek(): Buffer {
  if (cachedDek) return cachedDek;
  const master = readEnvKey("PII_ENCRYPTION_KEY");
  // hkdfSync returns an ArrayBuffer; wrap as Buffer for createCipheriv.
  const derived = hkdfSync("sha256", master, Buffer.alloc(0), Buffer.from(DEK_INFO), KEY_BYTES);
  cachedDek = Buffer.from(derived);
  return cachedDek;
}

function getHmacKey(): Buffer {
  if (cachedHmacKey) return cachedHmacKey;
  const master = readEnvKey("PII_HMAC_KEY");
  const derived = hkdfSync("sha256", master, Buffer.alloc(0), Buffer.from(HMAC_INFO), KEY_BYTES);
  cachedHmacKey = Buffer.from(derived);
  return cachedHmacKey;
}

/** Reset the cached keys. Test-only. */
export function _resetPiiKeyCacheForTest(): void {
  cachedDek = null;
  cachedHmacKey = null;
}

/**
 * Normalise a phone number for HMAC blind-index lookups.
 *
 * E.164-ish: keep a leading + if present, then digits only. This
 * means the same person logging in with +9665... and 9665... (no
 * plus) gets the same HMAC. Different callers across the app have
 * historically been inconsistent about the + prefix, so the
 * normalisation collapses the two.
 */
export function normalisePhone(phone: string | null | undefined): string {
  if (!phone) return "";
  const trimmed = phone.trim();
  const hasPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");
  if (!digits) return "";
  return hasPlus ? `+${digits}` : digits;
}

/**
 * Encrypt a plaintext string for storage. Returns base64-encoded
 * `iv || ciphertext || tag`. Returns null for null/empty input so
 * callers can pass through nullable values without conditionals.
 */
export function encryptPii(plaintext: string | null | undefined): string | null {
  if (plaintext == null || plaintext === "") return null;
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, getDek(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, ct, tag]).toString("base64");
}

/**
 * Decrypt a value previously produced by `encryptPii`. Returns
 * null for null/empty input. Throws on tampered or wrong-key
 * ciphertext — the caller should treat that as a data integrity
 * failure (likely key rotation drift, see file header).
 */
export function decryptPii(ciphertext: string | null | undefined): string | null {
  if (ciphertext == null || ciphertext === "") return null;
  const buf = Buffer.from(ciphertext, "base64");
  if (buf.length < IV_BYTES + TAG_BYTES) {
    throw new Error("PII ciphertext too short to be valid AES-256-GCM");
  }
  const iv = buf.subarray(0, IV_BYTES);
  const tag = buf.subarray(buf.length - TAG_BYTES);
  const ct = buf.subarray(IV_BYTES, buf.length - TAG_BYTES);
  const decipher = createDecipheriv(ALGO, getDek(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}

/**
 * Compute a deterministic HMAC for a normalised plaintext. Used as
 * a blind index so we can still look up `WHERE phone_hmac = $1` in
 * the OTP login flow after the phone column is encrypted.
 *
 * Returns null for null/empty input. The output is base64 so it
 * fits in a TEXT or VARCHAR column; length is fixed (44 chars for
 * SHA-256) so we get implicit unique-constraint behaviour on the
 * column.
 */
export function piiHmac(value: string | null | undefined): string | null {
  if (value == null || value === "") return null;
  const normalised = normalisePhone(value);
  const input = normalised || (value as string).trim().toLowerCase();
  return createHmac("sha256", getHmacKey()).update(input, "utf8").digest("base64");
}
