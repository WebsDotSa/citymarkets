// Admin: returns readiness for each notification channel.
// Used by the Providers tab to render ✅/⚠ cards.

import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-api-auth";
import { isEmailConfigured } from "@/lib/email";
import { isNativePushConfigured } from "@/lib/native-push";
import { isTwilioMessagingConfigured } from "@/lib/twilio-messaging";

function vapidConfigured(): boolean {
  return !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

function sseConfigured(): boolean {
  // SSE requires no extra config — every Next.js route handler supports
  // streaming responses. Always available.
  return true;
}

export async function GET(request: NextRequest) {
  const gate = await requireAdminApi(request, "manage_broadcasts");
  if (gate instanceof NextResponse) return gate;

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
        configured: isNativePushConfigured(),
        env: ["APNS_KEY_ID", "APNS_TEAM_ID", "APNS_BUNDLE_ID", "APNS_KEY_PATH"],
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