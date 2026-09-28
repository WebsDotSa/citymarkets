import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import crypto from "crypto";

import {
  CV_UPLOAD_IP_CONFIG,
  checkRateLimit,
  createRateLimitHeaders,
} from "@/lib/rate-limit";
import { getClientIp } from "@/lib/request-ip";
import { error as logError } from "@/lib/logger";

export const dynamic = "force-dynamic";

const UPLOAD_DIR = path.join(process.cwd(), "public", "images", "employment");

/**
 * Public, anonymous endpoint used by the /employment page to attach a
 * CV file. We don't require a customer session because applicants are
 * typically unauthenticated visitors. The file is stored under
 * `public/images/employment/` and the relative URL is later inserted
 * alongside the application row in `job_applications`.
 *
 * Allowed extensions: .pdf, .doc, .docx
 * Max size: 8 MB
 *
 * SECURITY: IP rate limit (CV_UPLOAD_IP_CONFIG, 5 per 10 min) bounds
 * disk-fill DoS. Without this an attacker could repeatedly post 8 MB
 * PDFs to fill the volume until the deployer's disk alert fires.
 */
function isAllowedExt(ext: string): boolean {
  return [".pdf", ".doc", ".docx"].includes(ext.toLowerCase());
}

function detectFromHeader(buffer: Buffer): "pdf" | "doc" | "docx" | null {
  // PDF: %PDF-
  if (
    buffer.length >= 5 &&
    buffer[0] === 0x25 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x44 &&
    buffer[3] === 0x46 &&
    buffer[4] === 0x2d
  ) {
    return "pdf";
  }
  // MS Office compound (DOCX/XLSX/PPTX) — ZIP header PK\x03\x04
  if (
    buffer.length >= 4 &&
    buffer[0] === 0x50 &&
    buffer[1] === 0x4b &&
    buffer[2] === 0x03 &&
    buffer[3] === 0x04
  ) {
    return "docx";
  }
  // Legacy .doc — D0 CF 11 E0 A1 B1 1A E1 (OLE compound)
  if (
    buffer.length >= 8 &&
    buffer[0] === 0xd0 &&
    buffer[1] === 0xcf &&
    buffer[2] === 0x11 &&
    buffer[3] === 0xe0 &&
    buffer[4] === 0xa1 &&
    buffer[5] === 0xb1 &&
    buffer[6] === 0x1a &&
    buffer[7] === 0xe1
  ) {
    return "doc";
  }
  return null;
}

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  const rl = await checkRateLimit(ip, CV_UPLOAD_IP_CONFIG);
  if (!rl.allowed) {
    return NextResponse.json(
      { success: false, error: "تجاوزت الحد المسموح من رفع السير الذاتية" },
      { status: 429, headers: createRateLimitHeaders(rl) },
    );
  }

  try {
    const formData = await request.formData();
    const file = formData.get("cv") || formData.get("file");
    if (!file || !(file instanceof File)) {
      return NextResponse.json(
        { success: false, error: "لم يتم رفع أي ملف" },
        { status: 400 }
      );
    }

    // 8 MB cap
    if (file.size > 8 * 1024 * 1024) {
      return NextResponse.json(
        { success: false, error: "حجم السيرة الذاتية يجب ألا يتجاوز 8 ميجابايت" },
        { status: 400 }
      );
    }
    if (file.size < 100) {
      return NextResponse.json(
        { success: false, error: "الملف صغير جداً" },
        { status: 400 }
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const detected = detectFromHeader(buffer);
    if (!detected) {
      return NextResponse.json(
        { success: false, error: "نوع الملف غير مدعوم. الرجاء رفع PDF أو Word" },
        { status: 400 }
      );
    }

    const clientExt = path.extname(file.name || "").toLowerCase();
    if (!isAllowedExt(clientExt)) {
      return NextResponse.json(
        { success: false, error: "امتداد الملف غير مدعوم" },
        { status: 400 }
      );
    }

    fs.mkdirSync(UPLOAD_DIR, { recursive: true });

    const safeExt = detected === "pdf" ? ".pdf" : detected === "docx" ? ".docx" : ".doc";
    const filename = `cv_${Date.now()}_${crypto.randomBytes(6).toString("hex")}${safeExt}`;
    const targetPath = path.join(UPLOAD_DIR, filename);
    fs.writeFileSync(targetPath, buffer);

    return NextResponse.json({
      success: true,
      data: {
        url: `/images/employment/${filename}`,
        filename,
        size: file.size,
      },
    });
  } catch (error) {
    logError("CV upload error:", error);
    return NextResponse.json(
      { success: false, error: "فشل رفع السيرة الذاتية" },
      { status: 500 }
    );
  }
}
