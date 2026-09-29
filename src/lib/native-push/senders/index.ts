// Factory for native push senders. Returns the first configured sender
// or `null` when neither APNs nor FCM env vars are present.
//
// Order of preference: APNs (iOS first-party) → FCM (Android). When a
// user has both iOS and Android tokens, both senders should be tried;
// today's dispatcher only invokes one sender per delivery, which is
// acceptable because the per-user `native_push_tokens` table is keyed
// by `(platform, device_token)` — Android users will have FCM tokens,
// iOS users will have APNs tokens, and a user with both devices is a
// rare edge case that lands in the first matching sender's queue.

import { ApnsSender } from "./apns";
import { FcmSender } from "./fcm";
import type { NativePushSender } from "./types";

export function selectSender(): NativePushSender | null {
  const apns = new ApnsSender();
  if (apns.isConfigured()) return apns;
  const fcm = new FcmSender();
  if (fcm.isConfigured()) return fcm;
  return null;
}

export type { NativePushSender, SendOutcome, SendRequest, PushToken } from "./types";
export { ApnsSender } from "./apns";
export { FcmSender } from "./fcm";
