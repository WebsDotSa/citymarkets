// Admin: returns readiness for each notification channel.
// Used by the Providers tab to render ✅/⚠ cards.

import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/identity/admin-api-auth-db";
import { isEmailConfigured } from "@/lib/email";
import { isTwilioMessagingConfigured } from "@/lib/twilio-messaging";
import { isApnsConfigured } from "@/lib/env";
import { isFcmSenderConfigured } from "@/lib/env";

function vapidConfigured(): boolean {
  return !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

function sseConfigured(): boolean {
  // SSE requires no extra config — every Next.js route handler supports
  // streaming responses. Always available.
  return true;
}

/**
 * Today no concrete APNs/FCM sender has landed (see
 * `src/lib/native-push/senders/`). When the env is set but the sender
 * is still a stub, the UI shows "متغيرات البيئة مكتملة — المرسل قيد
 * التنفيذ" so an admin knows the deployment is mid-roll-out.
 */
function isNativePushSenderImplemented(): boolean {
  // Heuristic: if neither apn nor firebase-admin is installed as a
  // dependency, no real send can run. We keep this conservative —
  // when the real implementations land, this flips to true.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require.resolve("apn");
    return true;
  } catch {
    // ignore
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require.resolve("firebase-admin");
    return true;
  } catch {
    // ignore
  }
  return false;
}

export async function GET(request: NextRequest) {
  const gate = await requireAdminApi(request, "manage_broadcasts");
  if (gate instanceof NextResponse) return gate;

  const apnsConfigured = isApnsConfigured();
  const fcmConfigured = isFcmSenderConfigured();
  const nativeConfigured = apnsConfigured || fcmConfigured;
  const nativeImplemented = isNativePushSenderImplemented();

  return NextResponse.json({
    success: true,
    data: [
      {
        channel: "web_push",
        label: "Push (متصفح)",
        configured: vapidConfigured(),
        env: ["VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT"],
      },
      {
        channel: "native_push",
        label: "Push (تطبيق iOS/Android)",
        configured: nativeConfigured,
        sender_implemented: nativeImplemented,
        detail: !nativeConfigured
          ? "بحاجة إلى APNS_KEY_ID, APNS_TEAM_ID, APNS_BUNDLE_ID, APNS_KEY_PATH أو FCM_PROJECT_ID + FCM_SERVICE_ACCOUNT_JSON"
          : !nativeImplemented
            ? "متغيرات البيئة مكتملة — المرسل قيد التنفيذ"
            : "جاهز للإرسال",
        env: [
          "APNS_KEY_ID",
          "APNS_TEAM_ID",
          "APNS_BUNDLE_ID",
          "APNS_KEY_PATH",
          "FCM_PROJECT_ID",
          "FCM_SERVICE_ACCOUNT_JSON",
        ],
      },
      {
        channel: "sms",
        label: "SMS",
        configured: isTwilioMessagingConfigured(),
        env: ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_MESSAGING_SERVICE_SID"],
      },
      {
        channel: "email",
        label: "Email Pro",
        configured: isEmailConfigured(),
        env: ["RESEND_API_KEY", "RESEND_FROM"],
      },
      {
        channel: "in_app",
        label: "بروتوكول مباشر (SSE)",
        configured: sseConfigured(),
        env: [],
      },
    ],
  });
}