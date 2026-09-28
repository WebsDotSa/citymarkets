import {
  getTwilioAuthHeader,
  getTwilioMessagingServiceSid,
  isTwilioMessagingConfigured,
} from "@/lib/twilio-config";
import { normalizeSaudiToE164 } from "@/lib/phone-format";
import { error as logError, warn as logWarn } from "@/lib/logger";

const MESSAGES_API = "https://api.twilio.com/2010-04-01/Accounts";

export { isTwilioMessagingConfigured };

export type SendSmsResult =
  | { ok: true; sid: string }
  | { ok: false; error: string; code?: number };

export async function twilioSendSms(
  toPhone: string,
  body: string
): Promise<SendSmsResult> {
  if (!isTwilioMessagingConfigured()) {
    return { ok: false, error: "twilio_messaging_not_configured" };
  }

  const e164 = normalizeSaudiToE164(toPhone);
  if (!e164) {
    return { ok: false, error: "invalid_phone" };
  }

  const accountSid = process.env.TWILIO_ACCOUNT_SID!.trim();
  const messagingSid = getTwilioMessagingServiceSid()!;
  const params = new URLSearchParams({
    To: e164,
    MessagingServiceSid: messagingSid,
    Body: body.slice(0, 1600),
  });

  const res = await fetch(
    `${MESSAGES_API}/${encodeURIComponent(accountSid)}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization: getTwilioAuthHeader(),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params,
    }
  );

  const data = (await res.json().catch(() => ({}))) as {
    sid?: string;
    message?: string;
    code?: number;
  };

  if (!res.ok) {
    logError("twilio-sms send failed", undefined, { status: res.status, code: data.code, message: data.message });
    return {
      ok: false,
      error: data.message || "twilio_send_failed",
      code: data.code,
    };
  }

  return { ok: true, sid: data.sid || "" };
}

/** إشعار طلب — لا يوقف مسار إنشاء الطلب عند الفشل */
export async function sendOrderConfirmationSms(input: {
  phone: string;
  orderId: string | number;
  total: number;
}): Promise<void> {
  if (!isTwilioMessagingConfigured()) return;

  const totalStr = Number(input.total).toFixed(2);
  const body = `أسواق سيتي: تم استلام طلبك #${input.orderId} بمبلغ ${totalStr} ر.س. شكراً لتسوقك معنا.`;

  const result = await twilioSendSms(input.phone, body);
  if (!result.ok) {
    logWarn("twilio-sms order notification skipped", { orderId: input.orderId, error: result.error });
  }
}
