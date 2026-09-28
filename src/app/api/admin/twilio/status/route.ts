import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-api-auth";
import {
  isTwilioMessagingConfigured,
  isTwilioVerifyConfigured,
} from "@/lib/twilio-config";
import { twilioVerifyHealthCheck } from "@/lib/twilio-verify";

export const dynamic = "force-dynamic";

/** حالة تكامل Twilio للمشرف — بدون كشف أسرار */
export async function GET(request: NextRequest) {
  const gate = await requireAdminApi(request);
  if (gate instanceof NextResponse) return gate;

  const verifyConfigured = isTwilioVerifyConfigured();
  const messagingConfigured = isTwilioMessagingConfigured();

  let verifyHealth: Awaited<ReturnType<typeof twilioVerifyHealthCheck>> | null =
    null;
  if (verifyConfigured) {
    verifyHealth = await twilioVerifyHealthCheck();
  }

  return NextResponse.json({
    verify: {
      configured: verifyConfigured,
      healthy: verifyHealth?.ok ?? false,
      serviceName: verifyHealth?.verifyServiceName,
      error: verifyHealth?.error,
    },
    messaging: {
      configured: messagingConfigured,
    },
    features: {
      loginOtp: verifyConfigured && (verifyHealth?.ok ?? false),
      orderSms: messagingConfigured,
    },
  });
}
