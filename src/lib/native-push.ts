// Native push sender (APNs + FCM).
//
// Tokens are already registered in `native_push_tokens` (migration 041).
// Today no concrete APNs/FCM library is wired in; this module routes
// through a provider abstraction (`src/lib/native-push/senders/`) so
// the dispatcher can distinguish:
//   - env vars missing  → `skipped: true, reason: "not_configured"`
//   - user has no device tokens → `skipped: true, reason: "no_tokens"`
//   - env present, sender still a stub → `skipped: true, reason: "sender_not_implemented"`
//
// To enable APNs (real send):
//   - APNS_KEY_ID, APNS_TEAM_ID, APNS_BUNDLE_ID, APNS_KEY_PATH
//   - Implement `ApnsSender.send()` in `src/lib/native-push/senders/apns.ts`
//     using either the `apn` npm package or a manual HTTP/2 client to
//     `api.push.apple.com`.
// To enable FCM (real send):
//   - FCM_PROJECT_ID + FCM_SERVICE_ACCOUNT_JSON (FCM v1) or FCM_SERVER_KEY (legacy)
//   - Implement `FcmSender.send()` in `src/lib/native-push/senders/fcm.ts`
//     using `firebase-admin`.
//
// The worker calls `sendNativePushToUser()` once per delivery. Failures
// are non-fatal: the dispatcher marks the delivery `skipped` or
// `failed` in `broadcast_deliveries` based on the outcome and continues
// to the next delivery.

import { isNativePushSenderConfigured } from "@/lib/env";
import { selectSender } from "@/lib/native-push/senders";
import { warn as logWarn } from "@/lib/logger";
import { pool } from "@/lib/db";

export interface NativePushPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
  imageUrl?: string;
}

/**
 * Result shape returned to the broadcast dispatcher. The dispatcher
 * branches on `skipped`; when true, the delivery is marked skipped in
 * `broadcast_deliveries` (with `reason` recorded as `error_message`).
 * The optional `reason` field is a new addition over the original
 * stub — it lets the dispatcher distinguish `not_configured` from the
 * new `sender_not_implemented` so an admin can tell in the broadcast
 * metrics panel that the env is set but the concrete send code hasn't
 * shipped yet.
 */
export interface NativePushResult {
  sent: number;
  failed: number;
  skipped: boolean;
  reason?: "not_configured" | "no_tokens" | "sender_not_implemented";
}

export function isNativePushConfigured(): boolean {
  return isNativePushSenderConfigured();
}

/**
 * Load every registered device token for a user from the
 * `native_push_tokens` table. Tokens are stored as `(platform, device_token)`
 * with an FK on `user_id`. We map `platform='apns'` → `"ios"` and
 * `platform='fcm'` → `"android"` so the sender abstraction only sees
 * the normalized form.
 */
async function loadPushTokens(userId: string): Promise<
  { token: string; platform: "ios" | "android" }[]
> {
  try {
    const r = await pool.query(
      `SELECT device_token, platform FROM native_push_tokens WHERE user_id = $1::uuid`,
      [userId],
    );
    return r.rows.map((row: { device_token: string; platform: string }) => ({
      token: row.device_token,
      platform: row.platform === "apns" ? "ios" : "android",
    }));
  } catch (err) {
    logWarn("[native-push] failed to load push tokens", {
      userId,
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

export async function sendNativePushToUser(
  userId: string,
  payload: NativePushPayload,
): Promise<NativePushResult> {
  if (!isNativePushConfigured()) {
    logWarn("[native-push] not configured; skipping", { userId });
    return { sent: 0, failed: 0, skipped: true, reason: "not_configured" };
  }

  const sender = selectSender();
  if (!sender) {
    // Defensive: `isNativePushConfigured()` returned true but no sender
    // is registered. Shouldn't happen, but surface it as not_configured
    // rather than crashing the dispatch loop.
    logWarn("[native-push] no sender selected despite config check", { userId });
    return { sent: 0, failed: 0, skipped: true, reason: "not_configured" };
  }

  const tokens = await loadPushTokens(userId);
  if (tokens.length === 0) {
    return { sent: 0, failed: 0, skipped: true, reason: "no_tokens" };
  }

  const outcome = await sender.send({ userId, payload, tokens });
  if (outcome.status === "skipped") {
    return { sent: 0, failed: 0, skipped: true, reason: outcome.reason };
  }
  return { sent: outcome.sent, failed: outcome.failed, skipped: false };
}
