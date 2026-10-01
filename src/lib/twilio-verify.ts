import {
  getTwilioAuthHeader,
  getTwilioVerifyServiceSid,
  isTwilioVerifyConfigured,
} from "@/lib/twilio-config";
import { error as logError } from "@/lib/logger";

export { isTwilioVerifyConfigured };

const VERIFY_BASE = "https://verify.twilio.com/v2";

type TwilioErrorBody = {
  message?: string;
  code?: number;
  more_info?: string;
  status?: number;
};

/**
 * Known Twilio Verify / Verify API error codes that recur on this
 * codebase. Maps the numeric code returned by Twilio to a short
 * operator hint describing what went wrong on the Twilio account side.
 * Reference: https://www.twilio.com/docs/errors
 *
 * Best-effort guidance — always defer to Twilio's `more_info` URL when
 * present. Add new codes here as they surface in production logs.
 */
const TWILIO_ERROR_HINTS: Record<number, string> = {
  60000: "Invalid 'To' phone number format (must be E.164, e.g. +966****)",
  60200: "Invalid parameter sent to Verify (check Channel/To/Code values)",
  60203: "Maximum send-code attempts reached for this phone — try later",
  60204: "Phone number is on the fraud blocklist",
  60212: "Geo Permissions: country is not enabled on the Verify Service (verify Twilio Console → Verify → Services → Geo Permissions)",
  60238: "Verification Creation Attempt blocked by Twilio (Geo Permissions / fraud / regulatory block). Enable Saudi Arabia (+966) in Verify Service Geo Permissions.",
  20404: "Resource not found — verify TWILIO_VERIFY_SERVICE_SID exists and starts with VE/VA",
};

/**
 * Build a structured error payload that surfaces every field Twilio
 * returned (code, message, more_info) AND the local operator hint
 * table entry for known codes, AND the serviceSid for log correlation.
 * Replaces the bare `{status, code, message}` log call that lost
 * `more_info` and the operator hint.
 */
function buildTwilioErrorLog(
  label: string,
  res: Response,
  err: TwilioErrorBody,
  serviceSid: string | null
): Record<string, unknown> {
  const hint =
    err.code !== undefined && TWILIO_ERROR_HINTS[err.code]
      ? TWILIO_ERROR_HINTS[err.code]
      : undefined;
  return {
    label,
    httpStatus: res.status,
    twilioCode: err.code,
    twilioMessage: err.message,
    twilioMoreInfo: err.more_info,
    operatorHint: hint,
    verifyServiceSid: serviceSid,
  };
}

/**
 * استجابة POST /Verifications من Twilio.
 * `send_code_attempts[].code` يظهر فقط عند تفعيل Debugger في خدمة Verify
 * (https://www.twilio.com/docs/verify/api/verification#debugger-mode)
 */
export type TwilioVerification = {
  sid?: string;
  account_sid?: string;
  to?: string;
  channel?: string;
  status?: string;
  valid?: boolean;
  date_created?: string;
  date_updated?: string;
  send_code_attempts?: Array<{
    channel?: string;
    attempt_sid?: string;
    time?: string;
    /** رمز التحقق الفعلي — يظهر فقط في وضع Debug */
    code?: string;
  }>;
};

async function parseTwilioError(res: Response): Promise<TwilioErrorBody> {
  try {
    return (await res.json()) as TwilioErrorBody;
  } catch {
    return { message: await res.text().catch(() => "unknown") };
  }
}

export async function twilioSendVerification(
  toE164: string
): Promise<TwilioVerification> {
  const serviceSid = getTwilioVerifyServiceSid();
  if (!serviceSid) throw new Error("twilio_not_configured");

  const body = new URLSearchParams({ To: toE164, Channel: "sms" });
  const res = await fetch(
    `${VERIFY_BASE}/Services/${encodeURIComponent(serviceSid)}/Verifications`,
    {
      method: "POST",
      headers: {
        Authorization: getTwilioAuthHeader(),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    }
  );

  if (!res.ok) {
    const err = await parseTwilioError(res);
    logError(
      "Twilio Verifications error",
      undefined,
      buildTwilioErrorLog("Verifications.create", res, err, serviceSid)
    );
    throw new Error(`twilio_send_failed:${err.code ?? res.status}`);
  }

  // نُعيد جسم الاستجابة كما هو — يحتوي على send_code_attempts[].code
  // فقط عند تفعيل Debug mode في خدمة Verify (مفيد للتشخيص من جهة العميل).
  try {
    return (await res.json()) as TwilioVerification;
  } catch {
    return {};
  }
}

export async function twilioCheckVerification(
  toE164: string,
  code: string
): Promise<boolean> {
  const serviceSid = getTwilioVerifyServiceSid();
  if (!serviceSid) throw new Error("twilio_not_configured");

  const body = new URLSearchParams({
    To: toE164,
    Code: code.trim(),
  });
  const res = await fetch(
    `${VERIFY_BASE}/Services/${encodeURIComponent(serviceSid)}/VerificationCheck`,
    {
      method: "POST",
      headers: {
        Authorization: getTwilioAuthHeader(),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    }
  );

  if (!res.ok) {
    const err = await parseTwilioError(res);
    logError(
      "Twilio VerificationCheck error",
      undefined,
      buildTwilioErrorLog("VerificationCheck.create", res, err, serviceSid)
    );
    return false;
  }

  const data = (await res.json()) as { status?: string };
  return data.status === "approved";
}

/** للتشخيص — يتحقق من صلاحية الحساب وخدمة Verify دون إرسال SMS */
export async function twilioVerifyHealthCheck(): Promise<{
  ok: boolean;
  verifyServiceName?: string;
  error?: string;
}> {
  if (!isTwilioVerifyConfigured()) {
    return { ok: false, error: "not_configured" };
  }

  const serviceSid = getTwilioVerifyServiceSid()!;
  const res = await fetch(
    `${VERIFY_BASE}/Services/${encodeURIComponent(serviceSid)}`,
    {
      headers: { Authorization: getTwilioAuthHeader() },
    }
  );

  if (!res.ok) {
    const err = await parseTwilioError(res);
    return { ok: false, error: err.message || `http_${res.status}` };
  }

  const data = (await res.json()) as { friendly_name?: string };
  return { ok: true, verifyServiceName: data.friendly_name };
}
