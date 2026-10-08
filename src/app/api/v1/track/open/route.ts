// Email open tracking — 1×1 transparent GIF.
//
// Tokens are HMAC-signed (see `src/lib/broadcasts/sign.ts`) so a
// random visitor can't inflate open metrics by hitting the endpoint
// with made-up ids. The pixel is embedded in the broadcast HTML by
// the email-dispatcher as `<img src=".../api/v1/track/open?d=<token>">`.

import { NextRequest } from "next/server";
import { pool } from "@/lib/db";
import { verifyDeliveryToken } from "@/lib/broadcasts/sign";
import { error as logError } from "@/lib/logger";

export const runtime = "nodejs";
// Re-mark delivered on first pixel load (image proxies / Gmail
// pre-fetch can trigger a load before the recipient "sees" the
// message — a real open is at minimum a load event).
const TRANSPARENT_GIF = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64",
);

export async function GET(request: NextRequest): Promise<Response> {
  const d = request.nextUrl.searchParams.get("d");
  if (!d) {
    return gifResponse(400);
  }
  const token = verifyDeliveryToken(d);
  if (!token) {
    return gifResponse(400);
  }

  try {
    await pool.query(
      `UPDATE broadcast_deliveries
          SET opened_at = COALESCE(opened_at, NOW()),
              delivered_at = COALESCE(delivered_at, NOW())
        WHERE id = $1 AND status IN ('sent', 'delivered', 'opened', 'clicked')`,
      [token.deliveryId],
    );
  } catch (err) {
    // Never leak the reason to the pixel — the image must still render
    // or the recipient's mail client flags it as broken.
    logError("[track/open] failed", err);
  }
  return gifResponse(200);
}

function gifResponse(status: number): Response {
  return new Response(TRANSPARENT_GIF, {
    status,
    headers: {
      "Content-Type": "image/gif",
      "Content-Length": String(TRANSPARENT_GIF.length),
      "Cache-Control": "no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
