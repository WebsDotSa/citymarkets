import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { ok, fail, ErrorCodes } from "@/lib/api-response";
import { error as logError } from "@/lib/logger";
import {
  CONTACT_FORM_IP_CONFIG,
  checkRateLimit,
  createRateLimitHeaders,
} from "@/lib/rate-limit";
import { getClientIp } from "@/lib/request-ip";

export async function POST(req: Request) {
  // SECURITY: anonymous POST into the support inbox. IP rate limit
  // (5 / 10 min) caps flood attacks against the contact_messages
  // table and avoids filling the support team's queue with junk.
  const ip = getClientIp(req as NextRequest);
  const rl = await checkRateLimit(ip, CONTACT_FORM_IP_CONFIG);
  if (!rl.allowed) {
    return NextResponse.json(
      {
        success: false,
        error: "تم استلام رسائلك مؤخراً. حاول بعد 10 دقائق.",
      },
      { status: 429, headers: createRateLimitHeaders(rl) },
    );
  }

  try {
    const body = await req.json();
    const { name, phone, email, subject, message } = body;

    if (!name || !phone || !message) {
      return fail(ErrorCodes.BAD_REQUEST, 400, { messageAr: "الاسم ورقم الهاتف والرسالة مطلوبة" });
    }

    try {
      await query(
        `INSERT INTO contact_messages (name, phone, email, subject, message, created_at)
         VALUES ($1, $2, $3, $4, $5, NOW())`,
        [name, phone, email || null, subject || null, message]
      );
    } catch (dbErr) {
      // SECURITY: do not log PII (name/phone/email/message). Only log a
      // redacted meta tag so support can correlate by the call site.
      logError("contact_messages insert failed", {
        hasName: Boolean(name),
        hasPhone: Boolean(phone),
        hasEmail: Boolean(email),
        subjectLength: typeof subject === "string" ? subject.length : 0,
        messageLength: typeof message === "string" ? message.length : 0,
        error: dbErr instanceof Error ? dbErr.message : String(dbErr),
      });
    }

    return ok({ message: "تم استلام رسالتك بنجاح" }, { status: 201 });
  } catch (error: any) {
    logError("Error submitting contact form", error);
    return fail(ErrorCodes.INTERNAL, 500, { messageAr: "حدث خطأ أثناء إرسال الرسالة" });
  }
}
