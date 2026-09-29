import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { resolveCustomerUserIdFromRequest } from '@/lib/identity';

import { error as logError, warn as logWarn, info as logInfo } from '@/lib/logger';

export const dynamic = "force-dynamic";

const UPLOAD_DIR = path.join(process.cwd(), "public", "images", "place-images");

/**
 * Detect actual image type from binary signature (magic bytes).
 * Prevents polyglot attacks where attacker uploads PHP/JS code with image MIME type.
 * Returns canonical extension or null if not a recognized image format.
 */
function detectImageMagicBytes(buffer: Buffer): { ext: string; mimetype: string } | null {
  // JPEG: FF D8 FF
  if (buffer.length >= 3 && buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
    return { ext: ".jpg", mimetype: "image/jpeg" };
  }
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47 &&
    buffer[4] === 0x0D && buffer[5] === 0x0A && buffer[6] === 0x1A && buffer[7] === 0x0A
  ) {
    return { ext: ".png", mimetype: "image/png" };
  }
  // GIF87a or GIF89a
  if (
    buffer.length >= 6 &&
    buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x38 &&
    (buffer[4] === 0x37 || buffer[4] === 0x39) && buffer[5] === 0x61
  ) {
    return { ext: ".gif", mimetype: "image/gif" };
  }
  // WebP: RIFF....WEBP
  if (
    buffer.length >= 12 &&
    buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
    buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50
  ) {
    return { ext: ".webp", mimetype: "image/webp" };
  }
  return null;
}

/**
 * POST /api/v1/upload/place-images
 *
 * Customer-facing image upload for the "Help the driver find you" feature.
 * Accepts multipart/form-data with `image` field.
 *
 * Returns: { success, data: { url, filename } }
 */
export async function POST(request: NextRequest) {
  const userId = await resolveCustomerUserIdFromRequest(request);
  if (!userId) {
    return NextResponse.json(
      { success: false, error: "غير مصرح" },
      { status: 401 }
    );
  }

  try {
    const formData = await request.formData();
    const file = formData.get("image") || formData.get("file");
    if (!file || !(file instanceof File)) {
      return NextResponse.json(
        { success: false, error: "لم يتم رفع أي ملف" },
        { status: 400 }
      );
    }

    // Validate size: 5 MB
    const buffer = Buffer.from(await file.arrayBuffer());
    if (buffer.length > 5 * 1024 * 1024) {
      return NextResponse.json(
        { success: false, error: "حجم الصورة يجب ألا يتجاوز 5 ميجابايت" },
        { status: 400 }
      );
    }

    // Validate actual file content via magic bytes (NOT just client-supplied MIME type).
    // Prevents polyglot attacks: malicious scripts disguised as images.
    const detected = detectImageMagicBytes(buffer);
    if (!detected) {
      return NextResponse.json(
        { success: false, error: "نوع الملف غير مدعوم أو الملف تالف" },
        { status: 400 }
      );
    }

    // Ensure target dir exists
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });

    // Use extension from validated magic bytes, NOT from client-supplied filename
    const filename = `${userId.slice(0, 8)}_${Date.now()}_${crypto.randomBytes(4).toString("hex")}${detected.ext}`;
    const targetPath = path.join(UPLOAD_DIR, filename);

    fs.writeFileSync(targetPath, buffer);

    const url = `/images/place-images/${filename}`;
    return NextResponse.json({
      success: true,
      data: { url, filename, size: buffer.length },
    });
  } catch (error: any) {
    logError("Place image upload error:", error);
    return NextResponse.json(
      { success: false, error: "فشل رفع الصورة" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/v1/upload/place-images?path=/images/place-images/xxx.jpg
 */
export async function DELETE(request: NextRequest) {
  const userId = await resolveCustomerUserIdFromRequest(request);
  if (!userId) {
    return NextResponse.json(
      { success: false, error: "غير مصرح" },
      { status: 401 }
    );
  }

  try {
    const url = new URL(request.url);
    const filePath = url.searchParams.get("path");
    if (!filePath || !filePath.startsWith("/images/place-images/")) {
      return NextResponse.json(
        { success: false, error: "مسار غير صالح" },
        { status: 400 }
      );
    }

    // Security: only allow deletion of files prefixed with the user's ID
    const filename = path.basename(filePath);
    if (!filename.startsWith(userId.slice(0, 8))) {
      return NextResponse.json(
        { success: false, error: "غير مصرح بحذف هذا الملف" },
        { status: 403 }
      );
    }

    const absolutePath = path.join(process.cwd(), "public", "images", "place-images", filename);
    if (fs.existsSync(absolutePath)) {
      fs.unlinkSync(absolutePath);
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    logError("Place image delete error:", error);
    return NextResponse.json(
      { success: false, error: "فشل حذف الصورة" },
      { status: 500 }
    );
  }
}