import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { resolveCustomerUserIdFromRequest } from '@/lib/identity';
import {
  AUDIO_UPLOAD_IP_CONFIG,
  checkRateLimit,
  createRateLimitHeaders,
} from '@/lib/rate-limit';
import { getClientIp } from '@/lib/request-ip';
import { error as logError } from '@/lib/logger';
import { uploadToR2 } from '@/lib/r2';

export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/upload/audio
 *
 * Customer uploads a voice note (WebM/MP4/Ogg from MediaRecorder).
 * Saved to Cloudflare R2 and served back via the public R2 URL.
 * The chat panel + direct-order creation both rely on this endpoint.
 *
 * Accepts multipart/form-data with a single 'file' field. Optional
 * 'kind' field is logged but ignored.
 *
 * SECURITY: authenticated users only (direct orders now require login).
 * IP rate limit (AUDIO_UPLOAD_IP_CONFIG) caps bandwidth and bounds spam.
 */
export async function POST(request: NextRequest) {
  const userId = await resolveCustomerUserIdFromRequest(request);

  // Require auth: direct orders now require login
  if (!userId) {
    return NextResponse.json(
      { success: false, error: 'غير مصرح' },
      { status: 401 }
    );
  }

  const ip = getClientIp(request);
  const rl = await checkRateLimit(ip, AUDIO_UPLOAD_IP_CONFIG);
  if (!rl.allowed) {
    return NextResponse.json(
      { success: false, error: 'تجاوزت الحد المسموح من رفع الملفات الصوتية' },
      { status: 429, headers: createRateLimitHeaders(rl) },
    );
  }

  try {
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return NextResponse.json({ success: false, error: 'فشل قراءة الملف' }, { status: 400 });
    }
    const file = form.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json({ success: false, error: 'لم يتم إرفاق ملف' }, { status: 400 });
    }
    if (file.size > 4 * 1024 * 1024) {
      return NextResponse.json({ success: false, error: 'الملف كبير (الحد 4 ميجا)' }, { status: 400 });
    }
    if (file.size < 256) {
      return NextResponse.json({ success: false, error: 'ملف فارغ' }, { status: 400 });
    }

    const buf = Buffer.from(await file.arrayBuffer());
    // Magic-byte sanity check: WebM starts with 0x1A 0x45 0xDF 0xA3 (EBML).
    // MP4/M4A may also be sent — accept the common audio containers.
    const isEbml = buf.length >= 4 && buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3;
    const isFtyp = buf.length >= 12 && buf.slice(4, 8).toString('ascii') === 'ftyp';
    const isOgg = buf.length >= 4 && buf[0] === 0x4f && buf[1] === 0x67 && buf[2] === 0x67 && buf[3] === 0x53;
    if (!isEbml && !isFtyp && !isOgg) {
      return NextResponse.json({ success: false, error: 'نوع ملف غير مدعوم' }, { status: 400 });
    }

    const ext = isEbml ? 'webm' : isFtyp ? 'm4a' : 'ogg';
    const contentType = isEbml ? 'audio/webm' : isFtyp ? 'audio/mp4' : 'audio/ogg';

    // Upload to R2 with a key like: voice/2026-10/uuid.{ext}
    const now = new Date();
    const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const uuid = crypto.randomUUID();
    const key = `voice/${yearMonth}/${uuid}.${ext}`;

    const r2Result = await uploadToR2({
      key,
      body: buf,
      contentType,
      cacheControl: 'public, immutable, max-age=31536000',
    });

    return NextResponse.json({
      success: true,
      url: r2Result.publicUrl,
      size: file.size,
      ext,
      userId,
    });
  } catch (err) {
    logError('audio upload to R2 failed', {
      err: (err as Error).message,
      stack: (err as Error).stack,
      userId,
    });
    return NextResponse.json(
      { success: false, error: 'فشل رفع الملف الصوتي، حاول مرة أخرى' },
      { status: 500 },
    );
  }
}