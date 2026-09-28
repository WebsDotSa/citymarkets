/** Twilio env helpers — secrets stay server-side only */

export function getTwilioAccountSid(): string | undefined {
  return process.env.TWILIO_ACCOUNT_SID?.trim() || undefined;
}

export function getTwilioAuthToken(): string | undefined {
  return process.env.TWILIO_AUTH_TOKEN?.trim() || undefined;
}

export function getTwilioVerifyServiceSid(): string | undefined {
  return process.env.TWILIO_VERIFY_SERVICE_SID?.trim() || undefined;
}

export function getTwilioMessagingServiceSid(): string | undefined {
  return process.env.TWILIO_MESSAGING_SERVICE_SID?.trim() || undefined;
}

export function getTwilioAuthHeader(): string {
  const sid = getTwilioAccountSid();
  const token = getTwilioAuthToken();
  if (!sid || !token) {
    throw new Error("twilio_not_configured");
  }
  const basic = Buffer.from(`${sid}:${token}`).toString("base64");
  return `Basic ${basic}`;
}

export function isTwilioVerifyConfigured(): boolean {
  return Boolean(
    getTwilioAccountSid() &&
      getTwilioAuthToken() &&
      getTwilioVerifyServiceSid()
  );
}

export function isTwilioMessagingConfigured(): boolean {
  return Boolean(
    getTwilioAccountSid() &&
      getTwilioAuthToken() &&
      getTwilioMessagingServiceSid()
  );
}

export function isTwilioConfigured(): boolean {
  return isTwilioVerifyConfigured() || isTwilioMessagingConfigured();
}
