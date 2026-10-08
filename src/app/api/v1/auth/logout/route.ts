import { NextRequest, NextResponse } from "next/server";
import { COOKIE_NAME, customerSessionCookieOptions } from '@/lib/identity';
import { pool } from '@/lib/db';
import { verifyCustomerToken } from '@/lib/identity/customer-session';

// SECURITY (PCP-145): clearing the cookie is NOT enough — a stolen
// customer JWT is still cryptographically valid until its 14d natural
// expiry. Bumping `users.token_version` invalidates the token so
// any subsequent request must re-authenticate. Without this, the
// logout button is purely cosmetic against a leaked JWT.
export async function POST(request: NextRequest) {
  const bearer =
    request.cookies.get(COOKIE_NAME)?.value ||
    (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const payload = bearer ? await verifyCustomerToken(bearer) : null;
  if (payload?.userId) {
    try {
      await pool.query(
        `UPDATE users
            SET token_version = COALESCE(token_version, 1) + 1,
                updated_at = NOW()
          WHERE id = $1`,
        [payload.userId],
      );
    } catch {
      // log-only; cookie-clear still protects the caller locally
    }
  }

  const res = NextResponse.json({ success: true });
  res.cookies.set(COOKIE_NAME, "", {
    ...customerSessionCookieOptions(),
    maxAge: 0,
  });
  return res;
}