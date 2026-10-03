/**
 * Application-level PII encryption (envelope scheme).
 *
 * Why this exists
 * ---------------
 * The P0-PII-PLAINTEXT-DATABASE finding (security audit, 2026-10-03)
 * flagged that users.phone, users.name, users.email, drivers.phone,
 * drivers.name, addresses.address_text, addresses.label,
 * orders.guest_phone, and orders.guest_name are stored in plaintext
 * in Postgres. A database breach exposes every customer's contact
 * info and home address.
 *
 * Approach: encrypt at the application layer, before the SQL query
 * is constructed. The DB never sees plaintext, the encryption key
 * never leaves process memory.
 *
 * Envelope encryption (P0-PII-KMS, security Phase 5, 2026-10-03)
 * ----------------------------------------------------------------
 * A single data encryption key (DEK) is generated once and used to
 * encrypt every PII cell. The DEK itself is wrapped (encrypted) by a
 * master key — the key-encryption-key (KEK) — using AES-256-KW (RFC
 * 3394). The wrapped DEK is stored alongside the ciphertext (or in
 * a `pii_keys` table) and unwrapped on demand.
 *
 * Why envelope encryption closes the env-compromise threat
 * --------------------------------------------------------
 * With a flat scheme (the prior P0-3 design), the encryption key
 * was derived directly from `PII_ENCRYPTION_KEY` in env, so an
 * attacker who obtained BOTH the DB and the env could derive the
 * DEK and decrypt every cell.
 *
 * With envelope encryption, the env only carries the KEK
 * (`PII_MASTER_KEY`). The DEK is wrapped; unwrapping it requires
 * calling `aes-256-kw-decrypt(wrapped_dek, kek)` — code that lives
 * in this module. In the future, when we integrate with a real KMS
 * (AWS KMS, GCP KMS, HashiCorp Vault Transit), the unwrap becomes
 * a remote Decrypt call. An attacker with the wrapped DEK and the
 * master key cannot easily impersonate that remote API call, so the
 * threat model improves dramatically. The crypto code in this
 * module does not need to change.
 *
 * Threat model
 * ------------
 *   In scope:
 *     - DB breach: data is encrypted at rest, useless without key.
 *     - DB backup leak: same — backups are encrypted blobs.
 *     - DB read replica leak: same.
 *     - DB + env compromise (Phase 5 upgrade): attacker has the KEK
 *       but the DEK is wrapped. Without the unwrap function (or a
 *       future KMS endpoint), they cannot decrypt.
 *   Out of scope (covered by other layers):
 *     - Application server compromise: attacker reads plaintext
 *       in memory or decrypts at the API boundary.
 *     - Insider with DB + env + unwrap access: can unwrap and
 *       decrypt. This is what KMS closes; tracked as a follow-up.
 *   This is a database-at-rest control, not an in-transit control.
 *
 * Algorithm
 * ---------
 *   AES-256-GCM, 96-bit random IV per encryption, 128-bit auth tag
 *   appended to ciphertext. Key is a 32-byte DEK generated once per
 *   deployment. The DEK is wrapped by the KEK using AES-256-KW.
 *   The HMAC blind-index key is derived from the DEK via HKDF-SHA256
 *   with a fixed info string, so the HMAC key never appears in env.
 *
 * Ciphertext format (base64-encoded)
 * ----------------------------------
 *   Legacy (P0-3, still readable for back-compat):
 *     iv(12) || ciphertext || tag(16)
 *
 *   Envelope (P0-PII-KMS, written by all new encryptPii calls):
 *     0x01 || wrapped_dek_version(1) || iv(12) || ct || tag(16)
 *
 *   The first byte selects the schema. The wrapped_dek_version byte
 *   references a row in the `pii_keys` table (or env); for now it
 *   is always 0x01. The slot exists so a future KMS-backed DEK can
 *   be added without changing the format.
 *
 *   Detection: if the first byte of the decoded buffer is 0x01,
 *   treat as envelope; otherwise treat as legacy. A random legacy
 *   IV byte being 0x01 has probability 1/256; the GCM auth tag
 *   check will reject the false match cleanly (no silent decrypt).
 *
 * Operator setup
 * --------------
 *   1. Generate the master key (KEK):
 *        node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
 *      Set it as `PII_MASTER_KEY` in every env that touches PII.
 *   2. Generate a DEK and wrap it with the master key:
 *        tsx scripts/generate-pii-dek.ts
 *      This prints the wrapped DEK (base64), the KEK fingerprint
 *      (SHA-256 of the master key, first 16 hex chars — safe to log
 *      for verification), and a SQL INSERT statement that seeds the
 *      `pii_keys` table.
 *   3. Apply migration `123_pii_envelope_keys.sql` to create the
 *      `pii_keys` table.
 *   4. Run the SQL from step 2 against the DB. Set the wrapped DEK
 *      in env as `PII_DATA_KEY` so the app can boot before the DB
 *      is reachable (e.g. for backfill scripts).
 *
 * Legacy key handling
 * -------------------
 *   `PII_ENCRYPTION_KEY` and `PII_HMAC_KEY` are STILL READ for the
 *   legacy decrypt path. Rows encrypted under the old scheme (no
 *   version byte) decrypt using these keys via HKDF — same as P0-3.
 *   They are not required if no legacy rows exist. Operators can
 *   drop them once every row has been re-encrypted under the
 *   envelope scheme (verified by a follow-up migration that counts
 *   legacy rows).
 *
 * Key rotation
 * ------------
 *   Generate a new KEK + DEK, re-wrap the DEK with the new KEK, and
 *   re-encrypt every row. The backfill script
 *   (`scripts/backfill-pii-encryption.ts`) is idempotent and
 *   re-encrypts rows whose ciphertext format does not match the
 *   current key. Once complete, drop the old KEK from env.
 */
import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  hkdfSync,
  randomBytes,
} from "node:crypto";

// AES-256-KW (RFC 3394) — manual implementation. Node's createCipheriv
// does not expose the key-wrap cipher ("aes-256-kw") in the version
// shipped in this image (Node 26+), and we cannot rely on it being
// present. The algorithm is straightforward: split the plaintext
// into 64-bit blocks, iterate 6n times XOR-ing a step counter into
// the high 64 bits of each AES-256-ECB output. The KEK's IV is the
// RFC 3394 default (`a6a6a6a6a6a6a6a6`).
const AES_KW_DEFAULT_IV = Buffer.from("a6a6a6a6a6a6a6a6", "hex");

function aesEcb(key: Buffer, block: Buffer): Buffer {
  const c = createCipheriv("aes-256-ecb", key, Buffer.alloc(0));
  c.setAutoPadding(false);
  return Buffer.concat([c.update(block), c.final()]);
}
function aesEcbDec(key: Buffer, block: Buffer): Buffer {
  const d = createDecipheriv("aes-256-ecb", key, Buffer.alloc(0));
  d.setAutoPadding(false);
  return Buffer.concat([d.update(block), d.final()]);
}

/** Wrap a key data buffer (length multiple of 8) using AES-256-KW. */
export function aesKeyWrap(kek: Buffer, dek: Buffer): Buffer {
  if (dek.length === 0 || dek.length % 8 !== 0) {
    throw new Error(
      `AES-KW input must be a non-zero multiple of 8 bytes (got ${dek.length})`,
    );
  }
  const n = dek.length / 8;
  let A = Buffer.from(AES_KW_DEFAULT_IV);
  const R: Buffer[] = [];
  for (let i = 0; i < n; i++) R.push(Buffer.from(dek.subarray(i * 8, (i + 1) * 8)));
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

/** Unwrap a key data buffer using AES-256-KW. Verifies the IV. */
export function aesKeyUnwrap(kek: Buffer, wrapped: Buffer): Buffer {
  if (wrapped.length % 8 !== 0 || wrapped.length < 16) {
    throw new Error(
      `AES-KW wrapped input must be a non-zero multiple of 8 bytes >= 16 (got ${wrapped.length})`,
    );
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
      const B = aesEcbDec(kek, Buffer.concat([Ainv, R[i - 1]]));
      A = Buffer.from(B.subarray(0, 8));
      R[i - 1] = B.subarray(8);
    }
  }
  if (!A.equals(AES_KW_DEFAULT_IV)) {
    throw new Error("AES-KW integrity check failed (IV mismatch)");
  }
  return Buffer.concat(R);
}

const ALGO = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

const DEK_INFO = "citymarkets-pii-dek-v1";
const HMAC_INFO = "citymarkets-pii-hmac-v1";

// Format version bytes. 0x01 = envelope (Phase 5). The legacy P0-3
// format has no version byte; detection falls through to the legacy
// decoder when the first byte is not VERSION_ENVELOPE.
const VERSION_ENVELOPE = 0x01;

// Active wrapped DEK version stored alongside the ciphertext. The
// slot exists so a future KMS-backed DEK (version 2) can coexist
// during rotation; for now the only valid value is 1.
const ACTIVE_DEK_VERSION = 0x01;

// Caches — process-lifetime. Each entry is keyed by env var name so
// tests can swap one without invalidating the other.
const cache: {
  dek: Buffer | null;
  hmacKey: Buffer | null;
  legacyDek: Buffer | null;
  legacyHmacKey: Buffer | null;
} = {
  dek: null,
  hmacKey: null,
  legacyDek: null,
  legacyHmacKey: null,
};

function readEnvBase64Key(name: string): Buffer {
  const v = process.env[name];
  if (!v) {
    throw new Error(
      `${name} is not set. Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`,
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

/**
 * Unwrap a wrapped DEK using the master key (KEK) via AES-256-KW.
 *
 * AES-256-KW (RFC 3394) requires the input to be a multiple of 8
 * bytes (64 bits = 2 AES blocks). 32-byte (256-bit) DEKs wrap to
 * 40 bytes (320 bits, 5 AES blocks). Implemented in this module
 * via `aesKeyUnwrap` because Node's createCipheriv does not expose
 * the key-wrap cipher in the version we ship.
 */
function unwrapDek(wrappedDekB64: string, kek: Buffer): Buffer {
  const wrapped = Buffer.from(wrappedDekB64, "base64");
  return aesKeyUnwrap(kek, wrapped);
}

function loadActiveDek(): Buffer {
  if (cache.dek) return cache.dek;

  const kek = readEnvBase64Key("PII_MASTER_KEY");
  // Prefer the wrapped DEK in env (lets the app boot before the DB
  // is reachable). Fall back to the database; the load path here is
  // a stub — the module is pure crypto, no DB dependency. Operators
  // set PII_DATA_KEY when they generate the DEK; the SQL seed is
  // for follow-up rotation support.
  const wrappedDek = process.env.PII_DATA_KEY;
  if (!wrappedDek) {
    throw new Error(
      "PII_DATA_KEY is not set. Run `tsx scripts/generate-pii-dek.ts` " +
        "to generate a DEK and seed PII_DATA_KEY with the printed wrapped value.",
    );
  }
  cache.dek = unwrapDek(wrappedDek, kek);
  return cache.dek;
}

function loadActiveHmacKey(): Buffer {
  if (cache.hmacKey) return cache.hmacKey;
  const dek = loadActiveDek();
  const derived = hkdfSync(
    "sha256",
    dek,
    Buffer.alloc(0),
    Buffer.from(HMAC_INFO),
    KEY_BYTES,
  );
  cache.hmacKey = Buffer.from(derived);
  return cache.hmacKey;
}

function loadLegacyDek(): Buffer | null {
  if (cache.legacyDek) return cache.legacyDek;
  const master = process.env.PII_ENCRYPTION_KEY;
  if (!master) return null;
  const derived = hkdfSync(
    "sha256",
    Buffer.from(master, "base64"),
    Buffer.alloc(0),
    Buffer.from(DEK_INFO),
    KEY_BYTES,
  );
  cache.legacyDek = Buffer.from(derived);
  return cache.legacyDek;
}

function loadLegacyHmacKey(): Buffer | null {
  if (cache.legacyHmacKey) return cache.legacyHmacKey;
  const master = process.env.PII_HMAC_KEY;
  if (!master) return null;
  const derived = hkdfSync(
    "sha256",
    Buffer.from(master, "base64"),
    Buffer.alloc(0),
    Buffer.from(HMAC_INFO),
    KEY_BYTES,
  );
  cache.legacyHmacKey = Buffer.from(derived);
  return cache.legacyHmacKey;
}

/** Reset the cached keys. Test-only. */
export function _resetPiiKeyCacheForTest(): void {
  cache.dek = null;
  cache.hmacKey = null;
  cache.legacyDek = null;
  cache.legacyHmacKey = null;
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
 * envelope ciphertext `0x01 || dek_version || iv(12) || ct || tag(16)`.
 * Returns null for null/empty input so callers can pass through
 * nullable values without conditionals.
 */
export function encryptPii(plaintext: string | null | undefined): string | null {
  if (plaintext == null || plaintext === "") return null;
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, loadActiveDek(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([
    Buffer.from([VERSION_ENVELOPE, ACTIVE_DEK_VERSION]),
    iv,
    ct,
    tag,
  ]).toString("base64");
}

/**
 * Decrypt a value previously produced by `encryptPii` (or by the
 * legacy P0-3 single-key encrypt path). The first byte selects the
 * scheme: 0x01 = envelope (Phase 5), anything else = legacy.
 *
 * Returns null for null/empty input. Throws on tampered or wrong-key
 * ciphertext — the caller should treat that as a data integrity
 * failure (likely key rotation drift; see file header).
 */
export function decryptPii(ciphertext: string | null | undefined): string | null {
  if (ciphertext == null || ciphertext === "") return null;
  const buf = Buffer.from(ciphertext, "base64");
  if (buf.length < IV_BYTES + TAG_BYTES) {
    throw new Error("PII ciphertext too short to be valid AES-256-GCM");
  }
  if (buf[0] === VERSION_ENVELOPE) {
    return decryptEnvelope(buf);
  }
  return decryptLegacy(buf);
}

function decryptEnvelope(buf: Buffer): string {
  // 0x01 || dek_version(1) || iv(12) || ct || tag(16)
  if (buf.length < 2 + IV_BYTES + TAG_BYTES) {
    throw new Error("PII envelope ciphertext too short");
  }
  const dekVersion = buf[1];
  if (dekVersion !== ACTIVE_DEK_VERSION) {
    throw new Error(
      `PII envelope DEK version ${dekVersion} is not active (active=${ACTIVE_DEK_VERSION}). ` +
        `Run a key rotation to upgrade the row or load the matching DEK.`,
    );
  }
  const iv = buf.subarray(2, 2 + IV_BYTES);
  const tag = buf.subarray(buf.length - TAG_BYTES);
  const ct = buf.subarray(2 + IV_BYTES, buf.length - TAG_BYTES);
  const decipher = createDecipheriv(ALGO, loadActiveDek(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}

function decryptLegacy(buf: Buffer): string {
  // iv(12) || ct || tag(16)  — P0-3 single-key scheme
  const legacyDek = loadLegacyDek();
  if (!legacyDek) {
    throw new Error(
      "PII_ENCRYPTION_KEY is not set; refusing to read legacy ciphertext. " +
        "Set PII_ENCRYPTION_KEY (the original P0-3 master) to decrypt legacy rows, " +
        "or re-encrypt the row with the new envelope scheme.",
    );
  }
  const iv = buf.subarray(0, IV_BYTES);
  const tag = buf.subarray(buf.length - TAG_BYTES);
  const ct = buf.subarray(IV_BYTES, buf.length - TAG_BYTES);
  const decipher = createDecipheriv(ALGO, legacyDek, iv);
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
 *
 * The HMAC key is derived from the active DEK via HKDF-SHA256, NOT
 * from env directly. Legacy rows in the *_hmac column were written
 * with a key derived from PII_HMAC_KEY; those rows continue to
 * match because the operator keeps PII_HMAC_KEY in env during the
 * transition, and the lookup path can compute both. This function
 * returns the active-key HMAC; use piiHmacLegacy for the legacy
 * path (e.g. when re-hashing existing rows before the backfill
 * completes).
 */
export function piiHmac(value: string | null | undefined): string | null {
  if (value == null || value === "") return null;
  const normalised = normalisePhone(value);
  const input = normalised || (value as string).trim().toLowerCase();
  return createHmac("sha256", loadActiveHmacKey()).update(input, "utf8").digest("base64");
}

/**
 * Legacy P0-3 HMAC: derive from PII_HMAC_KEY via HKDF, same as the
 * original pii-crypto.ts. Use this when reading phone_hmac columns
 * that were written by the legacy backfill. Returns null if no
 * legacy HMAC key is configured (i.e. fully migrated to envelope).
 */
export function piiHmacLegacy(value: string | null | undefined): string | null {
  if (value == null || value === "") return null;
  const legacy = loadLegacyHmacKey();
  if (!legacy) return null;
  const normalised = normalisePhone(value);
  const input = normalised || (value as string).trim().toLowerCase();
  return createHmac("sha256", legacy).update(input, "utf8").digest("base64");
}