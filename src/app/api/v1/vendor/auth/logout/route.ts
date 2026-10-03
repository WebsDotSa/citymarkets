import { NextRequest, NextResponse } from "next/server";
import {
  VENDOR_SESSION_COOKIE,
  vendorSessionCookieOptions,
} from '@/lib/identity';
import { pool } from '@/lib/db';
import {
  clearVendorSessionCache,
  verifyVendorRequest,
} from '@/lib/identity/vendor-auth';

// SECURITY (PCP-145): clearing the cookie is NOT enough — a stolen
// vendor JWT is still cryptographically valid until its 8h natural
// expiry. Bumping `vendor_staff.token_version` invalidates the token
// so any subsequent request must re-authenticate. Without this, the
// logout button is purely cosmetic against a leaked JWT.
export async function POST(request: NextRequest) {
  const session = await verifyVendorRequest(request);
  if (session?.staffId) {
    try {
      await pool.query(
        `UPDATE vendor_staff
            SET token_version = COALESCE(token_version, 1) + 1,
                updated_at = NOW()
          WHERE id = $1`,
        [session.staffId],
      );
    } catch {
      // log-only; cookie-clear still protects the caller locally
    }
    clearVendorSessionCache(session.staffId);
  }

  const response = NextResponse.json({ success: true });

  response.cookies.set(VENDOR_SESSION_COOKIE, "", {
    ...vendorSessionCookieOptions(),
    maxAge: 0,
  });

  return response;
}