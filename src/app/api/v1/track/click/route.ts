// Email click tracking — marks the delivery as clicked and 302s
// to the original CTA URL.
//
// The `d` token identifies the delivery (HMAC-signed). The `url`
// query param is the actual destination. We constrain it to
// http(s) schemes and the project's own origin (or any
// explicitly allow-listed external host via env) — otherwise this
// endpoint would be a free open-redirect.

import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { verifyDeliveryToken } from "@/lib/broadcasts/sign";
import { sanitizeRedirectPath } from "@/lib/safe-redirect";
import { error as logError } from "@/lib/logger";

export const runtime = "nodejs";

function isAllowedExternal(u: URL): boolean {
  if (u.protocol !== "https:" && u.protocol !== "http:") return false;
  const host = u.hostname.toLowerCase();
  // Project's own domains — keep in lockstep with the proxy.
  if (host === "citymarkets.sa" || host.endsWith(".citymarkets.sa")) return true;
  // Optional explicit allowlist (comma-separated) for marketing
  // campaigns that legitimately link to other domains (eventbrite,
  // youtube, etc.).
  const allow = (process.env.BROADCAST_CLICK_ALLOWLIST ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return allow.includes(host);
}

export async function GET(request: NextRequest): Promise<Response> {
  const d = request.nextUrl.searchParams.get("d");
  const url = request.nextUrl.searchParams.get("url");
  if (!d || !url) {
    return NextResponse.json({ success: false, error: "missing_params" }, { status: 400 });
  }
  const token = verifyDeliveryToken(d);
  if (!token) {
    return NextResponse.json({ success: false, error: "invalid_token" }, { status: 400 });
  }

  // Mark clicked. The destination still gets a redirect even if the
  // DB write fails — a partial metric is better than a broken link.
  try {
    await pool.query(
      `UPDATE broadcast_deliveries
          SET clicked_at = COALESCE(clicked_at, NOW()),
              opened_at = COALESCE(opened_at, NOW())
        WHERE id = $1 AND status IN ('sent', 'delivered', 'opened', 'clicked')`,
      [token.deliveryId],
    );
  } catch (err) {
    logError("[track/click] update failed", err);
  }

  // Validate the destination.
  if (url.startsWith("/") && !url.startsWith("//") && !url.startsWith("/\\")) {
    // Same-origin path — use the existing sanitizer to avoid
    // //evil.example trickery.
    const safe = sanitizeRedirectPath(url, "/");
    const dest = new URL(safe, request.nextUrl.origin);
    return NextResponse.redirect(dest, 302);
  }
  try {
    const parsed = new URL(url);
    if (isAllowedExternal(parsed)) {
      return NextResponse.redirect(parsed, 302);
    }
  } catch {
    // fall through
  }
  return NextResponse.json({ success: false, error: "blocked_destination" }, { status: 400 });
}
