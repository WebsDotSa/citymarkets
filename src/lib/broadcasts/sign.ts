// HMAC sign/verify for email open-pixel + click-redirect tracking.
// The `d` query param embeds the delivery id; signing prevents random
// visitors from spamming the endpoint and inflating open/click metrics.

import { createHmac, timingSafeEqual } from "node:crypto";
import { isProd } from "@/lib/env";

const SECRET = () => {
  const v = process.env.BROADCAST_TRACK_SECRET;
  if (v && v.length > 0) return v;
  if (isProd) throw new Error("BROADCAST_TRACK_SECRET is required in production");
  return "dev-only-broadcast-secret-32-chars-min-x";
};

export interface SignedToken {
  deliveryId: string;
  /** epoch ms — token rejects after this */
  exp: number;
}

export function signDeliveryToken(deliveryId: string, ttlMs = 30 * 24 * 60 * 60 * 1000): string {
  const exp = Date.now() + ttlMs;
  const json = JSON.stringify({ deliveryId, exp });
  const payload = Buffer.from(json).toString("base64url");
  const sig = createHmac("sha256", SECRET()).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

export function verifyDeliveryToken(token: string): SignedToken | null {
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = createHmac("sha256", SECRET()).update(payload).digest();
  // Decode both sides to Buffer for a constant-time compare.
  let given: Buffer;
  try {
    given = Buffer.from(sig, "base64url");
  } catch {
    return null;
  }
  if (expected.length !== given.length) return null;
  if (!timingSafeEqual(expected, given)) return null;
  try {
    const json = Buffer.from(payload, "base64url").toString("utf8");
    const decoded = JSON.parse(json) as SignedToken;
    if (!decoded?.deliveryId || typeof decoded.exp !== "number") return null;
    if (Date.now() > decoded.exp) return null;
    return decoded;
  } catch {
    return null;
  }
}