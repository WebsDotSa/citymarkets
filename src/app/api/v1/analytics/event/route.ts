import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { error as logError, warn as logWarn } from "@/lib/logger";
import { getGuestSessionIdFromRequest } from "@/lib/customer-session";

/**
 * POST /api/v1/analytics/event
 *
 * Insert-only ledger for custom in-house events. Fire-and-forget from the
 * client (`keepalive: true`); always 204 on success, 204 on failure
 * (analytics is never allowed to break the page).
 *
 * Body:
 *   {
 *     eventName: string,                // required
 *     vendorId?: string,
 *     orderId?: string,
 *     productId?: string,
 *     revenue?: number,
 *     currency?: string,                // default SAR
 *     metadata?: Record<string, unknown>,
 *     userId?: string,                  // optional — server-side session may override
 *   }
 */

const ALLOWED_EVENTS = new Set([
  "add_to_cart",
  "remove_from_cart",
  "checkout_start",
  "purchase",
  "search",
  "signup",
  "view_item",
  "begin_checkout",
  "share",
  "exception",
]);

const MAX_NAME = 64;
const MAX_METADATA_BYTES = 8 * 1024;

function trim(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f-]{32,36}$/i.test(value);
}

function coerceRevenue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.round(value * 100) / 100);
  }
  if (typeof value === "string") {
    const n = parseFloat(value);
    if (Number.isFinite(n)) return Math.max(0, Math.round(n * 100) / 100);
  }
  return null;
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return new NextResponse(null, { status: 204 });
  }

  const eventName = trim(body.eventName, MAX_NAME);
  if (!eventName || !ALLOWED_EVENTS.has(eventName)) {
    return new NextResponse(null, { status: 204 });
  }

  const sessionId = getGuestSessionIdFromRequest(req);
  const vendorId = isUuid(body.vendorId) ? body.vendorId : null;
  const orderId = isUuid(body.orderId) ? body.orderId : null;
  const productId = isUuid(body.productId) ? body.productId : null;
  const userId = isUuid(body.userId) ? body.userId : null;
  const revenue = coerceRevenue(body.revenue);
  const currency = trim(body.currency, 3) ?? "SAR";

  let metadata = "{}";
  if (body.metadata && typeof body.metadata === "object") {
    try {
      const serialized = JSON.stringify(body.metadata);
      if (serialized.length <= MAX_METADATA_BYTES) metadata = serialized;
    } catch {
      metadata = "{}";
    }
  }

  try {
    const client = await pool.connect();
    try {
      await client.query(
        `INSERT INTO analytics_events
           (event_name, session_id, user_id, vendor_id, order_id, product_id, revenue, currency, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)`,
        [
          eventName,
          sessionId,
          userId,
          vendorId,
          orderId,
          productId,
          revenue,
          currency,
          metadata,
        ],
      );
    } finally {
      client.release();
    }
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    logWarn("[analytics] event insert failed", {
      err: err instanceof Error ? err.message : String(err),
    });
    // Never surface DB errors to the client.
    return new NextResponse(null, { status: 204 });
  }
}
