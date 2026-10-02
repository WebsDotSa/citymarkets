import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { getCustomerUserIdFromRequest } from '@/lib/identity';
import { getClientIp } from "@/lib/request-ip";
import { checkRateLimit, PUSH_SUBSCRIBE_IP_CONFIG } from "@/lib/rate-limit";

import { error as logError } from '@/lib/logger';

interface SubscriptionPayload {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export async function POST(req: NextRequest) {
  // SECURITY (PCP-141): per-IP cap on push subscription. The route
  // does NOT require an authenticated user — guests can subscribe
  // to the public track-page feed. CSRF middleware blocks bare
  // cross-origin POSTs, but a fresh csrf_token is issued on the
  // first GET to any page, so a scripted attacker can still pull
  // one down and spam NULL-user subscriptions. The endpoint-key
  // uniqueness in the DB limits the rows-on-disk damage, but the
  // broadcast worker still has to walk all NULL-user rows on every
  // send. 10/min/IP is well above the legitimate "subscribe once"
  // flow. Input validation below runs AFTER the rate-limit check
  // (no per-endpoint input here — the only fields are the
  // SubscriptionPayload shape).
  const pushRl = await checkRateLimit(
    `push:subscribe:${getClientIp(req)}`,
    PUSH_SUBSCRIBE_IP_CONFIG,
  );
  if (!pushRl.allowed) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  let body: SubscriptionPayload;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body?.endpoint || !body?.keys?.p256dh || !body?.keys?.auth) {
    return NextResponse.json({ error: "Missing subscription fields" }, { status: 400 });
  }

  // CRITICAL: never trust client-supplied x-user-id headers. Derive the
  // user id from the verified customer_session cookie. Guests can still
  // subscribe (user_id = NULL) for the public track page.
  const userId = await getCustomerUserIdFromRequest(req);

  try {
    const client = await pool.connect();
    try {
      await client.query(
        `INSERT INTO push_subscriptions (endpoint, p256dh, auth, user_id)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (endpoint) DO UPDATE
           SET p256dh = EXCLUDED.p256dh,
               auth   = EXCLUDED.auth,
               user_id = COALESCE(EXCLUDED.user_id, push_subscriptions.user_id)`,
        [body.endpoint, body.keys.p256dh, body.keys.auth, userId],
      );
    } finally {
      client.release();
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    logError("[push] subscribe failed:", err);
    return NextResponse.json({ error: "Internal" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const endpoint = searchParams.get("endpoint");
  if (!endpoint) {
    return NextResponse.json({ error: "Missing endpoint" }, { status: 400 });
  }

  // SECURITY (C1 RBAC): previously this endpoint was unauthenticated and
  // allowed any caller to delete arbitrary push subscriptions by guessing
  // or scraping endpoint URLs. We now require an authenticated user AND
  // restrict the DELETE to rows owned by that user.
  const userId = await getCustomerUserIdFromRequest(req);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const client = await pool.connect();
    try {
      const result = await client.query(
        `DELETE FROM push_subscriptions
         WHERE endpoint = $1 AND user_id = $2`,
        [endpoint, userId]
      );
      if (result.rowCount === 0) {
        // Don't leak whether the endpoint exists vs. not owned by caller.
        return NextResponse.json({ success: true });
      }
    } finally {
      client.release();
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    logError("[push] unsubscribe failed:", err);
    return NextResponse.json({ error: "Internal" }, { status: 500 });
  }
}
