// Native push sender (APNs + FCM) — skeleton.
//
// Tokens are already registered in `native_push_tokens` (migration 041).
// Today no sender library is wired in; this module is a typed stub that
// returns a "not_configured" result so the broadcast dispatcher can still
// mark the delivery as `skipped` and continue with other channels.
//
// To enable APNs:
//   - APNS_KEY_ID, APNS_TEAM_ID, APNS_BUNDLE_ID, APNS_KEY_PATH, APNS_ENVIRONMENT
//   - Use `apn` (npm) or HTTP/2 to api.push.apple.com
// To enable FCM:
//   - FCM_PROJECT_ID + FCM_SERVICE_ACCOUNT_JSON (FCM v1) or FCM_SERVER_KEY (legacy)
//   - Use `firebase-admin` (npm)
//
// The worker calls sendNativePushToUser() once per delivery; failures are
// non-fatal (skipped / failed status recorded in broadcast_deliveries).

import { isNativePushSenderConfigured } from "@/lib/env";
import { warn as logWarn } from "@/lib/logger";

export interface NativePushPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
  imageUrl?: string;
}

export interface NativePushResult {
  sent: number;
  failed: number;
  skipped: boolean;
}

export function isNativePushConfigured(): boolean {
  return isNativePushSenderConfigured();
}

export async function sendNativePushToUser(
  userId: string,
  _payload: NativePushPayload,
): Promise<NativePushResult> {
  if (!isNativePushConfigured()) {
    logWarn("[native-push] not configured; skipping", { userId });
    return { sent: 0, failed: 0, skipped: true };
  }
  // Native APNs/FCM sender implementation lands in a follow-up. For
  // now we no-op so the dispatcher surface stays unblocked.
  logWarn("[native-push] sender not implemented; skipping", { userId });
  return { sent: 0, failed: 0, skipped: true };
}