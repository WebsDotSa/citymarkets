// Lazy-loaded so the app builds even when web-push isn't installed
// (VAPID keys aren't required for the rest of the system).
import { error as logError, warn as logWarn } from '@/lib/logger';

let configured = false;
let webpushModule: typeof import("web-push") | null = null;

async function ensureConfigured() {
  if (configured && webpushModule) return true;
  // Use NEXT_PUBLIC_VAPID_PUBLIC_KEY (not VAPID_PUBLIC_KEY) so the
  // server and the client agree on the SAME env var. NEXT_PUBLIC_ is
  // a build-time marker that exposes the value to the browser bundle;
  // it does NOT restrict server-side access, so this works in both
  // runtimes. Using VAPID_PUBLIC_KEY here while the client reads
  // NEXT_PUBLIC_VAPID_PUBLIC_KEY silently breaks push because the
  // browser sees one key and the server tries to sign with another.
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || "mailto:admin@citymarkets.sa";
  if (!pub || !priv) {
    return false;
  }
  if (!webpushModule) {
    try {
      webpushModule = await import("web-push");
    } catch {
      logWarn("[push] web-push not installed; skipping.");
      return false;
    }
  }
  try {
    // web-push's setVapidDetails takes three positional args (subject,
    // publicKey, privateKey). The bundled type defs don't reflect that
    // (they're a 1-arg object stub), so we cast through `any` for the
    // call — the runtime signature in web-push-lib.js is `(subject,
    // publicKey, privateKey)`. An object-form call was previously used
    // here, which silently no-ops on the real API and meant push
    // notifications never worked even when VAPID env vars were set.
    (webpushModule.setVapidDetails as unknown as (
      s: string,
      pk: string,
      priv: string,
    ) => void)(subject, pub, priv);
    configured = true;
    return true;
  } catch (err) {
    logError("[push] vapid config failed", err);
    return false;
  }
}

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
}

export async function sendPushToEndpoint(
  endpoint: string,
  p256dh: string,
  auth: string,
  payload: PushPayload,
): Promise<{ ok: boolean; statusCode?: number; reason?: string }> {
  if (!await ensureConfigured()) {
    return { ok: false, reason: "vapid_not_configured" };
  }
  try {
    const result = await webpushModule!.sendNotification(
      { endpoint, keys: { p256dh, auth } },
      JSON.stringify(payload),
    );
    return { ok: true };
  } catch (err: unknown) {
    const error = err as { statusCode?: number; message?: string };
    return {
      ok: false,
      statusCode: error?.statusCode,
      reason: error?.message || "send_failed",
    };
  }
}

export async function sendPushToUser(
  userId: string,
  payload: PushPayload,
): Promise<{ sent: number; failed: number }> {
  if (!(await ensureConfigured())) {
    return { sent: 0, failed: 0 };
  }
  // Lazy import to avoid pulling pg here.
  const { pool } = await import("@/lib/db");
  const client = await pool.connect();
  let sent = 0;
  let failed = 0;
  try {
    const res = await client.query(
      `SELECT endpoint, p256dh, auth
       FROM push_subscriptions
       WHERE user_id = $1 OR user_id IS NULL`,
      [userId],
    );
    for (const row of res.rows) {
      const r = await sendPushToEndpoint(row.endpoint, row.p256dh, row.auth, payload);
      if (r.ok) sent++;
      else failed++;
      // Prune dead subscriptions (410 Gone or 404).
      if (r.statusCode === 404 || r.statusCode === 410) {
        await client.query(`DELETE FROM push_subscriptions WHERE endpoint = $1`, [row.endpoint]);
      }
    }
  } finally {
    client.release();
  }
  return { sent, failed };
}
