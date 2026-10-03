/**
 * User repository — PII-aware reads and writes.
 *
 * Why this exists
 * ---------------
 * Before P0-3, every query in the codebase that needed the user's
 * phone or name went directly to the `users` table. After P0-3
 * (security Phase 3, 2026-10-03), the plaintext columns are being
 * backfilled to encrypted + hmac columns in a separate operator-run
 * step, and a coordinated code change moves the hot paths off the
 * plaintext columns onto the new ones.
 *
 * This module is the canonical, PII-aware read/write surface for
 * the users table. Callers (login flow, profile read, profile
 * delete, profile update) should use these helpers instead of
 * constructing raw SQL. Centralising the encryption boundary here
 * means a future change — KMS envelope encryption, key rotation,
 * a switch to a different cipher — has one place to update.
 *
 * The helpers below read AND write both the plaintext and the
 * encrypted columns. The plaintext write is the path the legacy
 * sites still use; once those sites are migrated, the plaintext
 * write can be removed in a single follow-up commit.
 */
import { pool } from "@/lib/db";
import {
  encryptPii,
  decryptPii,
  piiHmac,
  normalisePhone,
} from "@/lib/security/pii-crypto";

export interface UserPii {
  id: string;
  phone: string;
  name: string | null;
  email: string | null;
}

/**
 * Look up a user by phone via the HMAC blind index.
 *
 * After P0-3 the canonical lookup is `WHERE phone_hmac = $1` on the
 * encrypted column. The function still reads the plaintext `phone`
 * column if the HMAC lookup misses, because the pre-backfill rows
 * (existing users with no phone_hmac) are still the majority during
 * the cutover window.
 */
export async function findUserByPhone(phone: string): Promise<UserPii | null> {
  const normalised = normalisePhone(phone);
  if (!normalised) return null;
  const hmac = piiHmac(normalised);

  // 1. Try the HMAC index (the post-P0-3 path).
  if (hmac) {
    const r = await pool.query<UserPii>(
      `SELECT id, phone, name, email FROM users WHERE phone_hmac = $1 LIMIT 1`,
      [hmac],
    );
    if (r.rows[0]) return r.rows[0];
  }

  // 2. Fall back to the plaintext column. The legacy
  //    `users.phone = $1` lookup with a normalised phone still
  //    resolves the pre-backfill rows. As the backfill progresses
  //    and more rows have phone_hmac set, this branch is hit less
  //    and less.
  const phoneDb = normalised.startsWith("+") ? normalised : `+${normalised}`;
  const r2 = await pool.query<UserPii>(
    `SELECT id, phone, name, email FROM users WHERE phone = $1 LIMIT 1`,
    [phoneDb],
  );
  return r2.rows[0] ?? null;
}

/**
 * Insert a new user with the provided PII. Writes BOTH the
 * plaintext columns (so the legacy read sites still see the row)
 * and the encrypted + hmac columns (so the post-P0-3 read sites
 * can use the new lookup path).
 *
 * Caller is responsible for generating the UUID. Returns the
 * inserted row. Throws on UNIQUE violation (phone already exists);
 * the caller should retry the lookup path instead of inserting.
 */
export async function createUserWithPii(input: {
  id: string;
  phone: string;
  name?: string | null;
  email?: string | null;
}): Promise<UserPii> {
  const normalised = normalisePhone(input.phone);
  const phoneDb = normalised.startsWith("+") ? normalised : `+${normalised}`;
  const hmac = piiHmac(normalised);
  const phoneEnc = encryptPii(phoneDb);
  const nameEnc = input.name ? encryptPii(input.name) : null;
  const emailEnc = input.email ? encryptPii(input.email) : null;

  const r = await pool.query<UserPii>(
    `INSERT INTO users (
       id, phone, name, email,
       phone_encrypted, phone_hmac, name_encrypted, email_encrypted
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id, phone, name, email`,
    [
      input.id,
      phoneDb,
      input.name ?? null,
      input.email ?? null,
      phoneEnc,
      hmac,
      nameEnc,
      emailEnc,
    ],
  );
  return r.rows[0];
}

/**
 * Decrypt the encrypted PII columns for a user row. The callers
 * that need the actual phone/name/email values (rather than just
 * the user id) call this after the row is loaded. The decryption
 * is decoupled from the load so the load query stays small and
 * the encryption surface is auditable.
 *
 * If the encrypted columns are not yet populated (pre-backfill
 * rows), the plaintext columns are returned as-is.
 */
export async function loadDecryptedUser(id: string): Promise<UserPii | null> {
  const r = await pool.query<
    UserPii & {
      phone_encrypted: string | null;
      name_encrypted: string | null;
      email_encrypted: string | null;
    }
  >(
    `SELECT id, phone, name, email,
            phone_encrypted, name_encrypted, email_encrypted
       FROM users WHERE id = $1 LIMIT 1`,
    [id],
  );
  const row = r.rows[0];
  if (!row) return null;

  return {
    id: row.id,
    phone: row.phone_encrypted ? decryptPii(row.phone_encrypted) ?? row.phone : row.phone,
    name: row.name_encrypted
      ? decryptPii(row.name_encrypted) ?? row.name
      : row.name,
    email: row.email_encrypted
      ? decryptPii(row.email_encrypted) ?? row.email
      : row.email,
  };
}
