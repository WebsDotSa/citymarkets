import { NextResponse } from "next/server";
import { isTwilioMessagingConfigured } from "@/lib/twilio-config";
import { isTwilioVerifyConfigured } from "@/lib/twilio-verify";

/** يعتمد على متغيرات البيئة وقت التشغيل — لا يُثبَّت عند `next build`. */
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    twilioOtp: isTwilioVerifyConfigured(),
    twilioMessaging: isTwilioMessagingConfigured(),
  });
}
