import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/request-ip";

import { error as logError } from "@/lib/logger";

// SECURITY (PCP-133): rate limit public employment applications.
// Without this, the form (and the resulting `employment_applications`
// row) can be flooded from a single IP. 5/hour/IP + 3/hour/phone
// (the latter is the real key — captures the same applicant across
// NAT'd networks).
const EMPLOYMENT_APPLY_IP_CONFIG = {
  maxRequests: 5,
  windowMs: 60 * 60 * 1000,
  keyPrefix: "employment:apply:ip",
} as const;

const EMPLOYMENT_APPLY_PHONE_CONFIG = {
  maxRequests: 3,
  windowMs: 60 * 60 * 1000,
  keyPrefix: "employment:apply:phone",
} as const;

export const dynamic = "force-dynamic";

const VALID_JOBS = new Set([
  "delivery",
  "picker",
  "customer-service",
  "marketing",
  "warehouse",
  "packer",
]);

const JOB_TITLES: Record<string, string> = {
  delivery: "سائق توصيل",
  picker: "جامع طلبات",
  "customer-service": "خدمة عملاء",
  marketing: "مسوق رقمي",
  warehouse: "عامل مستودع",
  packer: "مُعد طلبات",
};

/**
 * POST /api/v1/employment
 *
 * Public, anonymous endpoint used by the /employment form. CV upload
 * is OPTIONAL — admins collect it during onboarding if the candidate
 * is shortlisted. Removing the CV requirement eliminates the
 * "السيرة مطلوبة" friction at the top of the funnel.
 *
 * Body: { full_name, phone, email?, job_id, message?, cv_url?, cv_filename?, cv_size_bytes? }
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const fullName = String(body.full_name ?? "").trim();
    const phone = String(body.phone ?? "").trim();
    const email = body.email ? String(body.email).trim() : null;
    const jobId = String(body.job_id ?? "").trim();
    const message = body.message ? String(body.message).trim() : null;
    // CV fields are optional. If any one of them is present, all three
    // must be valid (so admins don't end up with a broken row referencing
    // a missing file). When all three are absent, the CV column stays NULL.
    const cvUrlRaw = body.cv_url ? String(body.cv_url).trim() : "";
    const cvFilenameRaw = body.cv_filename ? String(body.cv_filename).trim() : "";
    const cvSizeRaw = Number(body.cv_size_bytes ?? 0);
    const hasAnyCv = cvUrlRaw.length > 0 || cvFilenameRaw.length > 0 || cvSizeRaw > 0;
    const cvUrl = hasAnyCv ? cvUrlRaw : null;
    const cvFilename = hasAnyCv ? cvFilenameRaw : null;
    const cvSize = hasAnyCv ? cvSizeRaw : null;

    if (!fullName || fullName.length < 2) {
      return NextResponse.json(
        { success: false, error: "الاسم مطلوب" },
        { status: 400 }
      );
    }
    if (!/^[+\d\s()-]{8,20}$/.test(phone)) {
      return NextResponse.json(
        { success: false, error: "رقم الجوال غير صالح" },
        { status: 400 }
      );
    }

    // SECURITY (PCP-133): rate limit AFTER input validation so a bad
    // phone doesn't pollute the per-phone bucket. IP-first (caps NAT
    // floods); per-phone second (caps one applicant across IPs).
    const clientIp = getClientIp(request);
    const ipLimit = await checkRateLimit(clientIp, EMPLOYMENT_APPLY_IP_CONFIG);
    if (!ipLimit.allowed) {
      return NextResponse.json(
        { success: false, error: "تجاوزت عدد الطلبات، حاول لاحقاً" },
        { status: 429 }
      );
    }
    const phoneLimit = await checkRateLimit(phone, EMPLOYMENT_APPLY_PHONE_CONFIG);
    if (!phoneLimit.allowed) {
      return NextResponse.json(
        { success: false, error: "تم استلام طلبك مسبقاً" },
        { status: 429 }
      );
    }
    if (!VALID_JOBS.has(jobId)) {
      return NextResponse.json(
        { success: false, error: "الوظيفة المختارة غير صالحة" },
        { status: 400 }
      );
    }
    // Only enforce CV validation when at least one CV field was sent —
    // a partial CV payload is treated as malformed.
    if (hasAnyCv) {
      if (!cvUrl || !cvUrl.startsWith("/images/employment/")) {
        return NextResponse.json(
          { success: false, error: "رابط السيرة الذاتية غير صالح" },
          { status: 400 }
        );
      }
      if (!cvFilename) {
        return NextResponse.json(
          { success: false, error: "اسم ملف السيرة الذاتية مطلوب" },
          { status: 400 }
        );
      }
      if (!cvSize || cvSize <= 0) {
        return NextResponse.json(
          { success: false, error: "حجم السيرة الذاتية غير صالح" },
          { status: 400 }
        );
      }
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json(
        { success: false, error: "البريد الإلكتروني غير صالح" },
        { status: 400 }
      );
    }

    const jobTitle = JOB_TITLES[jobId];

    const result = await query(
      `INSERT INTO job_applications
         (full_name, phone, email, job_id, job_title, message,
          cv_url, cv_filename, cv_size_bytes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, created_at`,
      [fullName, phone, email, jobId, jobTitle, message, cvUrl, cvFilename, cvSize]
    );

    return NextResponse.json({
      success: true,
      data: {
        id: result.rows[0]?.id,
        created_at: result.rows[0]?.created_at,
      },
    });
  } catch (error) {
    logError("Employment submit error:", error);
    return NextResponse.json(
      { success: false, error: "فشل إرسال الطلب" },
      { status: 500 }
    );
  }
}
