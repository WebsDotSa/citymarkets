/**
 * Server-side auth helpers that complement (do NOT replace) the JWT
 * path in `@/lib/customer-session`.
 *
 * Two distinct auth surfaces exist in this project:
 *
 *   `@/lib/customer-session.ts`  (FAST PATH — 99% of routes)
 *     - Reads the customer_session cookie OR `Authorization: ***`
 *       header, runs HMAC verification with `jose`, returns userId.
 *     - Edge-safe (no `next/headers`, no Supabase client).
 *     - Used by every /api/v1 route that needs "who is the caller?".
 *
 *   `@/lib/auth-helpers.ts`  (FULL USER PATH — 2 routes today)
 *     - `getServerUser()` returns the full `User` row from the DB.
 *     - JWT-only since Supabase was removed (2026-09-30 cleanup).
 *     - `requireAuth()` returns either `{ user }` or a 401 NextResponse.
 *     - Currently used by /api/v1/profile and /api/v1/profile/delete —
 *       routes that need the FULL user record (avatar, loyalty points,
 *       etc.), not just the ID.
 *
 * Keep these two modules separate: collapsing `getServerUser()` into
 * `customer-session.ts` would force every /api/v1 route to load a DB
 * row just to check who the caller is. The current split keeps the
 * hot path light.
 */
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { COOKIE_NAME, verifyCustomerToken } from "./customer-session";
import { mapDbUserRow } from "./map-db-user";
import { assertTokenVersionMatches } from "./auth/token-version";
import { decryptPii } from "@/lib/security/pii-crypto";
import type { User } from "@/lib/types";

/**
 * H35 (audit 2026-09-30): file exports only functions (NOT a pure types
 * module — cannot be renamed to `auth-types.ts`). Exports:
 *   - getServerUser(): Promise<User | null>
 *   - requireAuth(): Promise<{ success: true, user: User } | NextResponse>
 */

/**
 * Get the current authenticated user from server-side context
 * Returns null if not authenticated
 */
export async function getServerUser(): Promise<User | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return null;

  const payload = await verifyCustomerToken(token);
  if (!payload) return null;

  const client = await pool.connect();
  try {
    // P1-3 (full-system audit 2026-09-30): `users.loyalty_points` /
    // `users.loyalty_tier` are legacy columns (001) that 021
    // superseded with the `loyalty_points` table. The legacy columns
    // are no longer written by the loyalty pipeline, so reading
    // them here returns stale data. LEFT JOIN the live table so the
    // JWT cookie carries the actual current balance.
    //
    // SECURITY (PCP-144): also SELECT `token_version` so we can
    // detect a bumped version (logout / password rotation) and
    // return null. Without this, a stolen customer JWT keeps
    // full access for up to 14 days (the JWT lifetime).
    const row = await client.query<Record<string, unknown>>(
      `SELECT u.id, u.phone, u.name, u.email, u.avatar_url,
              u.phone_encrypted, u.name_encrypted, u.email_encrypted,
              COALESCE(lp.balance, 0)::int AS loyalty_points,
              u.loyalty_tier,
              u.spin_count_today, u.last_spin_at, u.created_at, u.updated_at,
              COALESCE(u.token_version, 1)::int AS token_version
         FROM users u
         LEFT JOIN loyalty_points lp ON lp.user_id = u.id
        WHERE u.id = $1`,
      [payload.userId]
    );
    if (!row.rows[0]) return null;
    // SECURITY (PCP-144): token_version comparison. A bumped value
    // means the JWT was issued before the most recent logout or
    // credential rotation — reject by returning null. This forces
    // the caller to re-authenticate. A legacy JWT (no tokenVersion
    // claim) defaults to 1, which matches the row's initial value;
    // a freshly-minted JWT carries the live row value, so any
    // subsequent bump on the row (e.g. logout) makes the comparison
    // fail on the next request. The compare itself is centralised
    // in assertTokenVersionMatches so the customer / admin / vendor
    // verify paths cannot drift.
    const rawRow = row.rows[0] as Record<string, unknown> & {
      token_version: number;
      phone_encrypted?: string | null;
      name_encrypted?: string | null;
      email_encrypted?: string | null;
    };
    const dbTokenVersion = rawRow.token_version as number;
    if (!assertTokenVersionMatches(payload, dbTokenVersion)) {
      return null;
    }
    // P0-3 PII cutover: prefer the encrypted columns (decrypted) over the
    // plaintext columns. Falls back to the plaintext column for rows that
    // pre-date the backfill. See user-repo.ts loadDecryptedUser for the
    // canonical pattern; we re-implement inline because the hot path also
    // LEFT JOINs loyalty_points and the type is widened for that.
    const merged: Record<string, unknown> = { ...rawRow };
    if (rawRow.phone_encrypted) {
      const d = decryptPii(rawRow.phone_encrypted);
      if (d != null) merged.phone = d;
    }
    if (rawRow.name_encrypted) {
      const d = decryptPii(rawRow.name_encrypted);
      if (d != null) merged.name = d;
    }
    if (rawRow.email_encrypted) {
      const d = decryptPii(rawRow.email_encrypted);
      if (d != null) merged.email = d;
    }
    return mapDbUserRow(merged);
  } finally {
    client.release();
  }
}

/**
 * Require authentication in API routes
 * Returns the user if authenticated, or a 401 response if not
 */
export async function requireAuth() {
  const user = await getServerUser();

  if (!user) {
    return NextResponse.json(
      { success: false, error: "يجب تسجيل الدخول أولاً" },
      { status: 401 }
    );
  }

  return { success: true, user };
}
