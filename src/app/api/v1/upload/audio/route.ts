import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { resolveCustomerUserIdFromRequest } from '@/lib/identity';
import {
  AUDIO_UPLOAD_IP_CONFIG,
  checkRateLimit,
  createRateLimitHeaders,
} from '@/lib/rate-limit';
import { getClientIp } from '@/lib/request-ip';
import { error as logError } from '@/lib/logger';

export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/upload/audio
 *
 * Customer uploads a voice note (WebM/Opus from MediaRecorder). Saved
 * under /public/uploads/voice/ and served back via the public URL.
 * The chat panel + direct-order creation both rely on this endpoint.
 *
 * Accepts multipart/form-data with a single 'file' field. Optional
 * 'kind' field is logged but ignored.
 *
 * SECURITY: anonymous uploads allowed (matches the direct-order flow
 * before login). IP rate limit (AUDIO_UPLOAD_IP_CONFIG) caps disk
 * usage and bounds spam. Authenticated users still hit the same cap
 * keyed by IP — bot accounts alone don't bypass it.
 */
export async function POST(request: NextRequest) {
  const userId = await resolveCustomerUserIdFromRequest(request);

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
    const publicDir = path.join(process.cwd(), 'public');
    const dir = path.join(publicDir, 'uploads', 'voice');
    // Belt-and-suspenders: Dockerfile already pre-creates this dir,
    // but a recursive mkdirSync means a fresh container (e.g. dev) or
    // a custom override that points publicDir elsewhere will still work.
    fs.mkdirSync(dir, { recursive: true });

    const hash = crypto.randomBytes(8).toString('hex');
    const filename = `voice-${Date.now()}-${hash}.${ext}`;
    const filePath = path.join(dir, filename);
    fs.writeFileSync(filePath, buf);
    fs.chmodSync(filePath, 0o644);

    const url = `/uploads/voice/${filename}`;
    return NextResponse.json({ success: true, url, size: file.size, ext, userId });
  } catch (err) {
    // Mirrors the sibling CV/place-images routes: any unexpected throw
    // (formData, writeFileSync, permissions, ENOSPC, etc.) returns 500
    // with a friendly Arabic message and a structured log line for ops.
    logError('audio upload failed', {
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