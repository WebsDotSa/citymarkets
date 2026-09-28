// Email sender (Resend transactional API).
//
// Resend (https://resend.com) — single HTTPS POST per send, no SMTP infra.
// Free tier 3k/mo, supports Arabic, supports tags + open/click tracking.
//
// Env vars (all optional — the module degrades to a no-op when missing):
//   RESEND_API_KEY      re_xxxx
//   RESEND_FROM         e.g. "City Markets <noreply@citymarkets.sa>"
//   RESEND_REPLY_TO     e.g. "support@citymarkets.sa"

import { error as logError } from "@/lib/logger";
import {
  getResendApiKey,
  getResendFrom,
  getResendReplyTo,
  isResendConfigured,
} from "@/lib/env";

export function isEmailConfigured(): boolean {
  return isResendConfigured();
}

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
  tags?: { name: string; value: string }[];
}

export type SendEmailResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

const RESEND_API = "https://api.resend.com/emails";

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  if (!isEmailConfigured()) {
    return { ok: false, error: "email_not_configured" };
  }
  const apiKey = getResendApiKey();
  const from = getResendFrom();
  if (!apiKey || !from) {
    return { ok: false, error: "email_not_configured" };
  }
  try {
    const res = await fetch(RESEND_API, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: input.to,
        subject: input.subject,
        html: input.html,
        text: input.text,
        reply_to: input.replyTo ?? getResendReplyTo() ?? undefined,
        tags: input.tags,
      }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      id?: string;
      message?: string;
    };
    if (!res.ok || !data.id) {
      logError("[email] send failed", undefined, {
        status: res.status,
        message: data.message,
      });
      return { ok: false, error: data.message || "send_failed" };
    }
    return { ok: true, id: data.id };
  } catch (err) {
    logError("[email] exception", err);
    return { ok: false, error: "network_error" };
  }
}