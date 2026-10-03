import { NextRequest, NextResponse } from 'next/server';
import { getOrIssueCsrfToken } from '@/lib/csrf';

/**
 * GET /api/v1/auth/csrf
 *
 * Returns the current CSRF token as `{ token: "<hex>" }` and refreshes
 * the HTTPOnly `csrf_token` cookie if missing.
 *
 * This endpoint is the SOLE channel through which client JS obtains the
 * CSRF token. The cookie itself is HTTPOnly so `document.cookie` can
 * not read it; the token reaches JS via this same-origin JSON body.
 *
 * SECURITY (P2-2 / 2026-10-03): previously this route only set the
 * cookie (which JS could read directly via `document.cookie`) and
 * returned a generic success message. That was the double-submit
 * cookie pattern. We now echo the token in the body and the cookie
 * becomes HTTPOnly — JS can only read it through this endpoint.
 *
 * The endpoint is GET, so it is not itself CSRF-protected — a
 * cross-origin attacker who could make the browser send this request
 * and read the response body would already have a same-origin XSS
 * vector. CSRF against this endpoint is therefore moot.
 */
export async function GET(request: NextRequest) {
  // Reserve the token first so we know what to put in both the body
  // and the Set-Cookie. We mint the response body as a JSON object
  // literal and copy the queued Set-Cookie entries from a throwaway
  // response into the final one.
  const draft = new NextResponse(null, {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
  const token = await getOrIssueCsrfToken(request, draft);

  const final = NextResponse.json(
    { success: true, token },
    {
      status: 200,
      headers: {
        "cache-control": "no-store",
      },
    },
  );
  // Re-attach the Set-Cookie entries that `getOrIssueCsrfToken`
  // queued on the draft. `NextResponse.json` is a fresh response
  // and does not inherit cookies from `draft`.
  for (const c of draft.cookies.getAll()) {
    final.cookies.set(c.name, c.value, {
      httpOnly: c.httpOnly,
      sameSite: c.sameSite,
      secure: c.secure,
      path: c.path,
      maxAge: c.maxAge,
    });
  }
  return final;
}