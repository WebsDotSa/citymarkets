import { NextRequest, NextResponse } from 'next/server';
import { ADMIN_SESSION_COOKIE } from '@/lib/identity';
import { pool } from '@/lib/db';
import { clearAdminRoleCache } from '@/lib/identity/admin-api-auth-db';
import { verifyAdminRequest } from '@/lib/identity/admin-session';

// SECURITY (PCP-145): clearing the cookie is NOT enough — a stolen
// admin JWT is still cryptographically valid until its 7d natural
// expiry. Bumping `admin_users.token_version` forces the verify path
// (admin-api-auth-db.ts) to reject every outstanding token for this
// admin on the next request. Without this, the cookie-clear gives
// the caller a false sense of security.
export async function POST(request: NextRequest) {
  const admin = await verifyAdminRequest(request);
  if (admin) {
    try {
      await pool.query(
        `UPDATE admin_users
            SET token_version = COALESCE(token_version, 1) + 1,
                updated_at = NOW()
          WHERE id = $1`,
        [admin.id],
      );
    } catch {
      // Swallow — the cookie-clear below still protects the caller
      // locally. Log-only is fine here.
    }
    clearAdminRoleCache(admin.id);
  }

  const response = NextResponse.json({ success: true });
  response.cookies.set(ADMIN_SESSION_COOKIE, '', { maxAge: 0, path: '/' });
  return response;
}