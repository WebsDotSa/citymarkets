// Factory for native push senders. Returns ALL configured senders
// (audit K58). A user with both iOS and Android tokens registered
// needs BOTH providers tried — APNs for the iOS token, FCM for the
// Android one. The dispatcher in `src/lib/native-push.ts` iterates
// the list and filters tokens by `platform` before each send, so a
// single iOS user only goes through the APNs sender, a single Android
// user only through FCM, and a multi-device user through both.
//
// `selectSender()` (singular) is kept for callers that genuinely need
// at-most-one (tests, single-platform admin tooling). New code SHOULD
// prefer `selectSenders()` so a multi-device user is never silently
// dropped on the second platform.

import { ApnsSender } from "./apns";
import { FcmSender } from "./fcm";
import type { NativePushSender } from "./types";

export function selectSender(): NativePushSender | null {
  const all = selectSenders();
  return all[0] ?? null;
}

/**
 * Return every configured sender in registration order.
 *
 * Returns `[]` when no env vars are present (i.e. neither APNs nor
 * FCM is set up). The dispatcher's first check is `selectSenders()`
 * is non-empty; it does NOT consult `isNativePushConfigured()` (which
 * is just "is any one configured") so the per-platform token
 * filtering can fan out correctly.
 */
export function selectSenders(): NativePushSender[] {
  const senders: NativePushSender[] = [];
  const apns = new ApnsSender();
  if (apns.isConfigured()) senders.push(apns);
  const fcm = new FcmSender();
  if (fcm.isConfigured()) senders.push(fcm);
  return senders;
}

export type { NativePushSender, SendOutcome, SendRequest, PushToken } from "./types";
export { ApnsSender } from "./apns";
export { FcmSender } from "./fcm";
