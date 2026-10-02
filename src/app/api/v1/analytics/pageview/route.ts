import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { error as logError } from "@/lib/logger";
import { getClientIp } from "@/lib/request-ip";
import { checkRateLimit, PAGEVIEW_IP_CONFIG } from "@/lib/rate-limit";

const MAX_PATH = 500;
const MAX_REF = 500;
const MAX_VENDOR_SLUG = 80;

/**
 * Parse a vendor slug from the page path. Matches:
 *   /vendors/:slug
 *   /vendors/:slug/...
 *   /products/vendors/:slug (legacy vendor detail path)
 */
function parseVendorSlug(path: string): string | null {
  const m = path.match(/^\/(?:products\/)?vendors\/([a-z0-9][a-z0-9-]{0,78})(?:\/|$)/i);
  if (!m) return null;
  return m[1].toLowerCase();
}

/**
 * Lightweight device-type classifier. Avoids adding `ua-parser-js` for a
 * single field — Postgres only stores the bucket, not the raw UA.
 *
 *   bot    → crawlers / spiders / health checks
 *   tablet → iPad / Android without "Mobile"
 *   mobile → everything else (phones + feature phones)
 *   desktop → desktop OS without tablet tokens
 */
function classifyDevice(
  userAgent: string | null
): "mobile" | "tablet" | "desktop" | "bot" | null {
  if (!userAgent) return null;
  const ua = userAgent.toLowerCase();
  if (
    /bot|crawler|spider|slurp|facebookexternalhit|monitoring|preview|headless/i.test(
      ua
    )
  ) {
    return "bot";
  }
  if (/ipad|tablet|kindle|playbook|silk/.test(ua)) return "tablet";
  if (/android/.test(ua) && !/mobile/.test(ua)) return "tablet";
  if (
    /iphone|ipod|android.*mobile|windows phone|blackberry|opera mini|mobile/.test(
      ua
    )
  ) {
    return "mobile";
  }
  if (/macintosh|windows|linux|x11|cros/.test(ua)) return "desktop";
  return null;
}

export async function POST(req: NextRequest) {
  // SECURITY (PCP-142): per-IP cap on pageview beacon. The DB has a
  // (path, session_id, time_bucket) throttle that dedups within 30s
  // for a single session, but a scripted attacker can rotate
  // sessionIds and keep inserting. The endpoint is also a
  // worker-pinning vector — each accepted request still acquires
  // a PG connection. 120/min/IP is well above natural pageview
  // rate (≈1–3/min for an active session). Returns success on rate
  // limit to preserve the fire-and-forget contract.
  const pvRl = await checkRateLimit(
    `analytics:pageview:${getClientIp(req)}`,
    PAGEVIEW_IP_CONFIG,
  );
  if (!pvRl.allowed) {
    return NextResponse.json({ success: true, rate_limited: true });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const path = typeof body.path === "string" ? body.path.slice(0, MAX_PATH) : null;
  if (!path) {
    return NextResponse.json({ error: "Missing path" }, { status: 400 });
  }
  const ref = typeof body.referrer === "string" ? body.referrer.slice(0, MAX_REF) : null;
  const sessionId = typeof body.sessionId === "string" ? body.sessionId.slice(0, 64) : null;

  // Skip admin/vendor/api/internal paths.
  if (
    path.startsWith("/admin") ||
    path.startsWith("/vendor") ||
    path.startsWith("/api/") ||
    path.startsWith("/_next") ||
    path.startsWith("/assets/") ||
    path === "/favicon.ico" ||
    path === "/favicon-32.png" ||
    path === "/sw.js" ||
    path === "/robots.txt"
  ) {
    return NextResponse.json({ success: true, skipped: true });
  }

  // Country via Cloudflare header (preferred) — falls back to null.
  const country =
    req.headers.get("cf-ipcountry") ||
    req.headers.get("x-vercel-ip-country") ||
    null;

  const userAgent = req.headers.get("user-agent")?.slice(0, 500) || null;
  const vendorSlug = parseVendorSlug(path);
  const deviceType = classifyDevice(userAgent);

  try {
    const client = await pool.connect();
    try {
      // Throttle: only insert if no recent view for same path+session in 30s.
      // We do an insert in a CTE so the (path, session_id) throttling
      // sits on a unique index — concurrent retries just bump the count.
      await client.query(
        `INSERT INTO page_views
           (path, referrer, user_agent, session_id, country, vendor_slug, device_type, event_type, occurred_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'pageview', NOW())
         ON CONFLICT (path, session_id, time_bucket)
         DO NOTHING`,
        [
          path,
          ref,
          userAgent,
          sessionId,
          country,
          vendorSlug?.slice(0, MAX_VENDOR_SLUG) ?? null,
          deviceType,
        ],
      );
    } finally {
      client.release();
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    logError("[analytics] insert failed:", err);
    // Don't surface the error to the client — analytics is fire-and-forget.
    return NextResponse.json({ success: false }, { status: 204 });
  }
}
