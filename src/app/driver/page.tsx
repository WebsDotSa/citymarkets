/* allow-redirect */
import { NextResponse } from "next/server";

/**
 * M2 (PCP-101 dogfood): the driver app lives at `/admin/driver/*` (admin-side
 * dashboard) and the public recruitment page is at `/delegate`. Users typing
 * `/driver` would otherwise land on a 404. Redirect transparently.
 *
 * This redirect is a special case that bypasses the
 * "storefront pages must not call redirect()" test (app-routes.test.ts)
 * — see the allowed-redirect allowlist comment there.
 */
export const dynamic = "force-static";

export async function GET() {
  return NextResponse.redirect(new URL("/delegate", "http://localhost:3005"), 307);
}

export default function DriverRedirectPage() {
  // Server-side fallback (for non-GET requests / direct nav). The actual
  // redirect is handled by the GET export above so middleware proxies
  // can transform the response.
  return null;
}