/**
 * Server-side auth helpers that complement (do NOT replace) the JWT
 * path in `@/lib/customer-session`.
 *
 * Two distinct auth surfaces exist in this project:
 *
 *   `@/lib/customer-session.ts`  (FAST PATH — 99% of routes)
 *     - Reads the customer_session cookie OR `Authorization: Bearer`
 *       header, runs HMAC verification with `jose`, returns userId.
 *     - Edge-safe (no `next/headers`, no Supabase client).
 *     - Used by every /api/v1 route that needs "who is the caller?".
 *
 *   `@/lib/auth-helpers.ts`  (FULL USER PATH — 2 routes today)
 *     - `getServerUser()` returns the full `User` row from the DB.
 *     - Falls back to Supabase session if no JWT cookie (the OTP
 *       sign-in flow sets a Supabase session, not a JWT, so legacy
 *       logins still resolve here).
 *     - `requireAuth()` returns either `{ user }` or a 401 NextResponse.
 *     - Currently used by /api/v1/profile and /api/v1/profile/delete —
 *       routes that need the FULL user record (avatar, loyalty points,
 *       etc.), not just the ID.
 *
 * Keep these two modules separate: collapsing `getServerUser()` into
 * `customer-session.ts` would force every /api/v1 route to load a DB
 * row + Supabase client just to check who the caller is. The current
 * split keeps the hot path light.
 */
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { getSupabasePublicConfig } from "@/lib/env";
import { COOKIE_NAME, verifyCustomerToken } from "./customer-session";
import { mapDbUserRow } from "./map-db-user";
import type { User } from "@/lib/types";

/**
 * Get the current authenticated user from server-side context
 * Returns null if not authenticated
 */
export async function getServerUser(): Promise<User | null> {
  const cookieStore = await cookies();

  const { url: supabaseUrl, anonKey: supabaseAnon } = getSupabasePublicConfig();
  const supabase = createServerClient(
    supabaseUrl,
    supabaseAnon,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll() {
          // We can't set cookies in API routes this way, so we ignore
        },
      },
    }
  );

  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (session) {
    const { data: user } = await supabase
      .from("users")
      .select("*")
      .eq("id", session.user.id)
      .single();
    return (user as User) ?? null;
  }

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
    const row = await client.query(
      `SELECT u.id, u.phone, u.name, u.email, u.avatar_url,
              COALESCE(lp.balance, 0)::int AS loyalty_points,
              u.loyalty_tier,
              u.spin_count_today, u.last_spin_at, u.created_at, u.updated_at
         FROM users u
         LEFT JOIN loyalty_points lp ON lp.user_id = u.id
        WHERE u.id = $1`,
      [payload.userId]
    );
    if (!row.rows[0]) return null;
    return mapDbUserRow(row.rows[0]);
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

export async function createServerSupabaseClientAsync() {
  const cookieStore = await cookies();

  const { url: supabaseUrl, anonKey: supabaseAnon } = getSupabasePublicConfig();
  return createServerClient(
    supabaseUrl,
    supabaseAnon,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          // Ignore cookie setting for API routes
        },
      },
    }
  );
}
