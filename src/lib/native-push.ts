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
//
// Multi-device dispatch (audit K58): when BOTH APNs and FCM env vars
// are present, the dispatcher iterates ALL configured senders and
// filters tokens by `platform` before each send. A user with an iOS
// + Android device pair therefore gets two parallel delivery attempts,
// not just the first one. See `src/lib/native-push/senders/index.ts`
// for the factory contract.

import { isNativePushSenderConfigured } from "@/lib/env";
import {
  selectSenders,
  ApnsSender,
  FcmSender,
} from "@/lib/native-push/senders";
import type { NativePushSender, SendOutcome } from "@/lib/native-push/senders";
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

  const senders = selectSenders();
  if (senders.length === 0) {
    // Defensive: `isNativePushConfigured()` returned true but no sender
    // is registered. Shouldn't happen, but surface it as not_configured
    // rather than crashing the dispatch loop.
    logWarn("[native-push] no senders selected despite config check", { userId });
    return { sent: 0, failed: 0, skipped: true, reason: "not_configured" };
  }

  const tokens = await loadPushTokens(userId);
  if (tokens.length === 0) {
    return { sent: 0, failed: 0, skipped: true, reason: "no_tokens" };
  }

  // Audit K58: multi-device dispatch. Group tokens by platform so each
  // sender only receives the tokens it can deliver to. A user with
  // both iOS and Android devices gets a parallel send through both
  // configured providers; a user with only one platform only goes
  // through the matching sender.
  const aggregated = await dispatchToAllSenders({
    userId,
    payload,
    tokens,
    senders,
  });
  return aggregated;
}

/**
 * Internal helper: run the payload through every configured sender,
 * filtering tokens by `platform` before each send. Aggregates
 * `sent` / `failed` across senders and reports the worst-case
 * `reason` (`not_configured` / `no_tokens` / `sender_not_implemented`)
 * so the dispatcher can still mark a delivery `skipped` when ALL
 * senders reported `skipped`.
 *
 * `senders.length === 0` is a precondition violation — the caller
 * (`sendNativePushToUser`) already handles that case and returns
 * `not_configured` before reaching this function.
 */
async function dispatchToAllSenders(args: {
  userId: string;
  payload: NativePushPayload;
  tokens: { token: string; platform: "ios" | "android" }[];
  senders: NativePushSender[];
}): Promise<NativePushResult> {
  const platforms = new Set(args.tokens.map((t) => t.platform));
  let totalSent = 0;
  let totalFailed = 0;
  // Track skipped reasons across senders so a delivery is marked
  // skipped iff EVERY sender that could have delivered reported
  // `skipped`. A mixed result (some sent + some skipped) is reported
  // as a successful delivery with the partial-skip counts ignored.
  let anySent = false;
  const skippedReasons: NonNullable<NativePushResult["reason"]>[] = [];

  for (const sender of args.senders) {
    const targetPlatform: "ios" | "android" | null =
      sender instanceof ApnsSender
        ? "ios"
        : sender instanceof FcmSender
          ? "android"
          : null;
    if (!targetPlatform) {
      // Unknown sender type — pass through without filtering. Future
      // senders that handle both platforms must update this helper.
      const outcome: SendOutcome = await sender.send({
        userId: args.userId,
        payload: args.payload,
        tokens: args.tokens,
      });
      if (outcome.status === "sent") {
        anySent = true;
        totalSent += outcome.sent;
        totalFailed += outcome.failed;
      } else {
        skippedReasons.push(outcome.reason);
      }
      continue;
    }
    if (!platforms.has(targetPlatform)) continue; // no tokens for this platform

    const platformTokens = args.tokens.filter((t) => t.platform === targetPlatform);
    const outcome = await sender.send({
      userId: args.userId,
      payload: args.payload,
      tokens: platformTokens,
    });
    if (outcome.status === "sent") {
      anySent = true;
      totalSent += outcome.sent;
      totalFailed += outcome.failed;
    } else {
      skippedReasons.push(outcome.reason);
    }
  }

  if (anySent) {
    return { sent: totalSent, failed: totalFailed, skipped: false };
  }
  // No sender produced a `sent` outcome. Surface the most-specific
  // skip reason to the dispatcher; `sender_not_implemented` wins
  // over `no_tokens` because the latter implies the operator did
  // not register a token, while the former means the platform is
  // configured but the integration hasn't shipped.
  const reason: NonNullable<NativePushResult["reason"]> =
    skippedReasons.includes("sender_not_implemented")
      ? "sender_not_implemented"
      : skippedReasons.includes("no_tokens")
        ? "no_tokens"
        : "not_configured";
  return { sent: 0, failed: 0, skipped: true, reason };
}
