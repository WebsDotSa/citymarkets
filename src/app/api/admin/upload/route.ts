import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { requireAdminApi } from "@/lib/identity/admin-api-auth-db";
import { uploadToR2, deleteFromR2 } from '@/lib/r2';

import { error as logError, warn as logWarn, info as logInfo } from '@/lib/logger';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

const UPLOAD_DIR = path.join(process.cwd(), 'public', 'images');
const ALLOWED_FOLDERS = ['products', 'banners', 'categories', 'brands', 'stores', 'place-images', 'offers', 'vendors'] as const;
type AllowedFolder = typeof ALLOWED_FOLDERS[number];
function isAllowedFolderName(value: string): value is AllowedFolder {
  return (ALLOWED_FOLDERS as readonly string[]).includes(value);
}

// Allowed image types with their magic bytes (file signatures)
const ALLOWED_TYPES = {
  'image/jpeg': {
    signatures: [
      Buffer.from([0xFF, 0xD8, 0xFF]), // JPEG
    ],
    extensions: ['.jpg', '.jpeg'],
  },
  'image/png': {
    signatures: [
      Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), // PNG
    ],
    extensions: ['.png'],
  },
  'image/gif': {
    signatures: [
      Buffer.from([0x47, 0x49, 0x46, 0x38, 0x37, 0x61]), // GIF87a
      Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]), // GIF89a
    ],
    extensions: ['.gif'],
  },
  'image/webp': {
    signatures: [
      Buffer.from([0x52, 0x49, 0x46, 0x46]), // RIFF header (followed by WEBP)
    ],
    extensions: ['.webp'],
  },
};

// Validate magic bytes (file signature)
function validateMagicBytes(buffer: Buffer): { valid: boolean; mimetype: string } {
  // Check JPEG
  if (buffer.slice(0, 3).equals(Buffer.from([0xFF, 0xD8, 0xFF]))) {
    return { valid: true, mimetype: 'image/jpeg' };
  }
  
  // Check PNG
  if (buffer.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]))) {
    return { valid: true, mimetype: 'image/png' };
  }
  
  // Check GIF
  if (
    buffer.slice(0, 6).equals(Buffer.from([0x47, 0x49, 0x46, 0x38, 0x37, 0x61])) ||
    buffer.slice(0, 6).equals(Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]))
  ) {
    return { valid: true, mimetype: 'image/gif' };
  }
  
  // Check WebP (RIFF....WEBP)
  if (
    buffer.slice(0, 4).equals(Buffer.from([0x52, 0x49, 0x46, 0x46])) &&
    buffer.slice(8, 12).equals(Buffer.from([0x57, 0x45, 0x42, 0x50]))
  ) {
    return { valid: true, mimetype: 'image/webp' };
  }
  
  return { valid: false, mimetype: '' };
}

// Validate file extension matches content type
function validateExtension(filename: string, mimetype: string): boolean {
  const ext = path.extname(filename).toLowerCase();
  const allowed = ALLOWED_TYPES[mimetype as keyof typeof ALLOWED_TYPES];
  return allowed ? allowed.extensions.includes(ext) : false;
}

// Simple multipart parser for file uploads
async function parseMultipart(request: NextRequest): Promise<{ file: Buffer | null; filename: string; mimetype: string; folder: string }> {
  const formData = await request.formData();
  const file = formData.get('image') || formData.get('file');
  const folder = formData.get('folder') as string || 'products';

  if (!file || !(file instanceof File)) {
    return { file: null, filename: '', mimetype: '', folder };
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  return {
    file: buffer,
    filename: file.name,
    mimetype: file.type,
    folder,
  };
}

// POST /api/admin/upload - Upload image file
export async function POST(request: NextRequest) {
  try {
    const { file, filename, mimetype, folder } = await parseMultipart(request);

    const perm =
      folder === 'banners' ? 'manage_banners'
        : folder === 'offers' ? 'manage_offers'
        : folder === 'vendors' ? 'manage_store_settings'
        : 'manage_products';
    const gate = await requireAdminApi(request, perm);
    if (gate instanceof NextResponse) return gate;

    if (!file) {
      return NextResponse.json(
        { success: false, error: 'لم يتم رفع أي ملف' },
        { status: 400 }
      );
    }

    // Validate file size (10MB)
    if (file.length > 10 * 1024 * 1024) {
      return NextResponse.json(
        { success: false, error: 'حجم الصورة يجب ألا يتجاوز 10 ميجابايت' },
        { status: 400 }
      );
    }

    // Validate minimum file size (at least a few bytes)
    if (file.length < 100) {
      return NextResponse.json(
        { success: false, error: 'الملف صغير جداً' },
        { status: 400 }
      );
    }

    // Validate magic bytes (actual file content, not just mimetype header)
    const magicValidation = validateMagicBytes(file);
    if (!magicValidation.valid) {
      return NextResponse.json(
        { success: false, error: 'نوع الملف غير مدعوم أو الملف تالف' },
        { status: 400 }
      );
    }

    // Validate extension matches content type
    const clientExt = path.extname(filename).toLowerCase();
    const isAllowedExt = ['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(clientExt);
    if (!isAllowedExt) {
      return NextResponse.json(
        { success: false, error: 'امتداد الملف غير مدعوم' },
        { status: 400 }
      );
    }

    // Use validated mimetype from magic bytes, not client-provided
    const validatedMimetype = magicValidation.mimetype;
    
    // Determine extension based on actual content
    const allowed = ALLOWED_TYPES[validatedMimetype as keyof typeof ALLOWED_TYPES];
    const ext = allowed.extensions[0]; // Use canonical extension

    // Determine target subfolder — strict allowlist + path canonicalization
    // to prevent directory traversal (e.g. folder=../../etc/passwd).
    if (!isAllowedFolderName(folder)) {
      return NextResponse.json(
        { success: false, error: 'مجلد غير صالح' },
        { status: 400 }
      );
    }
    const safeFolder: AllowedFolder = folder;
    const targetDir = path.resolve(UPLOAD_DIR, safeFolder);
    // Defense in depth: confirm resolved path is inside UPLOAD_DIR.
    const resolvedUploadDir = path.resolve(UPLOAD_DIR) + path.sep;
    if (!targetDir.startsWith(resolvedUploadDir) && targetDir !== path.resolve(UPLOAD_DIR)) {
      return NextResponse.json(
        { success: false, error: 'مسار غير صالح' },
        { status: 400 }
      );
    }
    fs.mkdirSync(targetDir, { recursive: true });

    // Generate filename with validated extension
    const randomName = `${Date.now()}_${crypto.randomBytes(4).toString('hex')}${ext}`;
    const targetPath = path.join(targetDir, randomName);

    // Save file locally (cheap local copy, also a safety net if R2 is
    // temporarily unreachable — see `localFallback` below).
    fs.writeFileSync(targetPath, file);

    const localImageUrl = `/images/${safeFolder}/${randomName}`;
    // Absolute form of the local URL — used as a last-resort fallback so
    // the image_url field always passes the product Zod schema (which
    // requires `z.string().url()`). Without this, an R2 outage silently
    // turns into "Invalid url" on every product/category/banner save.
    const origin =
      request.headers.get("x-forwarded-origin") ??
      request.headers.get("origin") ??
      new URL(request.url).origin;
    const localImageUrlAbsolute = `${origin.replace(/\/$/, "")}${localImageUrl}`;

    // R2 mirror. Only folders that the public website actually loads
    // via the `<Image>` component get mirrored; vendor placeholders and
    // transient uploads stay local-only.
    const R2_MIRRORED_FOLDERS = new Set<AllowedFolder>([
      'products',
      'banners',
      'categories',
      'brands',
      'stores',
      'offers',
    ]);

    let finalImageUrl = localImageUrlAbsolute;
    if (R2_MIRRORED_FOLDERS.has(safeFolder)) {
      try {
        const r2Key = `${safeFolder}/${randomName}`;
        const result = await uploadToR2({
          key: r2Key,
          body: file,
          contentType: validatedMimetype,
        });
        finalImageUrl = result.publicUrl;
        logInfo('mirrored to R2', { key: r2Key, etag: result.etag });
      } catch (r2Err) {
        // Fall back to local URL — admin still gets a usable link and
        // we surface a warning in the response so the operator can
        // decide whether to re-upload. This keeps uploads working
        // during an R2 outage instead of 500-ing the dashboard.
        logWarn('R2 mirror failed, serving local copy', {
          folder: safeFolder,
          filename: randomName,
          error: r2Err instanceof Error ? r2Err.message : String(r2Err),
        });
        // Surface the fallback URL as absolute so downstream Zod
        // `z.string().url()` checks pass.
        finalImageUrl = localImageUrlAbsolute;
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        url: finalImageUrl,
        filename: randomName,
        localUrl: localImageUrl,
        r2: finalImageUrl !== localImageUrlAbsolute,
      },
    });
  } catch (error: unknown) {
    logError('Upload error:', error);
    // Don't expose internal error details to client
    const message = error instanceof Error ? error.message : 'خطأ غير معروف';
    return NextResponse.json(
      { success: false, error: 'فشل رفع الملف' },
      { status: 500 }
    );
  }
}

// DELETE /api/admin/upload?path=/images/banners/xxx.jpg
export async function DELETE(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const filePath = url.searchParams.get('path');

    if (!filePath || !filePath.startsWith('/images/')) {
      return NextResponse.json(
        { success: false, error: 'مسار غير صالح' },
        { status: 400 }
      );
    }

    // Security: derive the subfolder from the allowlisted list BEFORE
    // touching the filesystem, then map it to the permission needed to
    // mutate that folder. The previous substring-on-raw-path check let an
    // admin with `manage_products` delete files in any folder by
    // manipulating the path string.
    const subfolder = filePath.split('/').filter(Boolean)[1];
    if (!subfolder || !isAllowedFolderName(subfolder)) {
      return NextResponse.json(
        { success: false, error: 'مسار غير صالح' },
        { status: 400 }
      );
    }
    const filename = path.basename(filePath);
    if (
      filename !== filePath.split('/').pop() ||
      !/^[A-Za-z0-9._-]+$/.test(filename)
    ) {
      return NextResponse.json(
        { success: false, error: 'مسار غير صالح' },
        { status: 400 }
      );
    }

    // Containment check — mirror the POST branch so a malformed input
    // can never resolve outside UPLOAD_DIR.
    const absolutePath = path.join(
      process.cwd(),
      'public',
      'images',
      subfolder,
      filename
    );
    const resolvedUploadDir = path.resolve(UPLOAD_DIR) + path.sep;
    if (!absolutePath.startsWith(resolvedUploadDir)) {
      return NextResponse.json(
        { success: false, error: 'مسار غير صالح' },
        { status: 400 }
      );
    }

    // Permission is decided by the VERIFIED subfolder, not by the raw
    // path string the client sent us.
    const folderPerm: Record<AllowedFolder, string> = {
      products: 'manage_products',
      banners: 'manage_banners',
      categories: 'manage_products',
      brands: 'manage_products',
      stores: 'manage_store_settings',
      'place-images': 'manage_products',
      offers: 'manage_offers',
      vendors: 'manage_store_settings',
    };
    const perm = folderPerm[subfolder];
    const gate = await requireAdminApi(request, perm);
    if (gate instanceof NextResponse) return gate;

    if (fs.existsSync(absolutePath)) {
      fs.unlinkSync(absolutePath);
    }

    // Mirror the deletion to R2. Only folders we actively mirror
    // (products/banners/categories/brands/stores/offers) ever made it
    // to R2, so the same allowlist gates the cleanup — vendor
    // placeholders and transient uploads have nothing to remove
    // remotely.
    const R2_MIRRORED_FOLDERS = new Set<AllowedFolder>([
      'products',
      'banners',
      'categories',
      'brands',
      'stores',
      'offers',
    ]);
    if (R2_MIRRORED_FOLDERS.has(subfolder)) {
      const r2Key = `${subfolder}/${filename}`;
      try {
        await deleteFromR2(r2Key);
        logInfo('deleted from R2', { key: r2Key });
      } catch (r2Err) {
        // Don't fail the request — the local copy is already gone and
        // the DB row is the source of truth. Surface the error in the
        // log so an operator can sweep stale objects later.
        logWarn('R2 delete failed, local file removed', {
          key: r2Key,
          error: r2Err instanceof Error ? r2Err.message : String(r2Err),
        });
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    logError('Delete file error:', error);
    return NextResponse.json(
      { success: false, error: 'فشل حذف الملف' },
      { status: 500 }
    );
  }
}
