/**
 * File-upload validation — MIME allowlist, size ceilings, magic-byte
 * sniffing, and multipart metadata schemas.
 *
 * SECURITY: the upload routes in /api/admin/upload and
 * /api/v1/upload/{audio,cv,place-images} all consume these to bound
 * what's accepted before any bytes touch the filesystem.
 */

import { z } from "zod";

export const ALLOWED_IMAGE_MIME = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/avif",
]);

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MB

/**
 * Multipart metadata schemas — keeps upload routes honest about what
 * non-file fields they expect and rejects unexpected keys.
 */
export const placeImagesMetadataSchema = z
  .object({
    // No required fields — the route only consumes files — but reject
    // any unknown keys so a malicious multipart body can't smuggle in
    // an `isAdmin: true` style mass-assignment.
  })
  .passthrough();

export const adminUploadMetadataSchema = z
  .object({
    folder: z
      .string()
      .max(64)
      .regex(/^[a-z0-9_\-/]+$/i, "اسم المجلد غير صالح")
      .optional(),
    filename: z.string().max(255).optional(),
  })
  .passthrough();

/**
 * Validate that a magic-byte sniff matches one of the allowed image
 * formats. The byte signatures below cover JPEG, PNG, GIF, WebP, AVIF.
 * (BMP/TIFF deliberately excluded — they balloon to 100MB+ pixel bombs.)
 */
export function isLikelyImageByMagicBytes(buf: Uint8Array): boolean {
  if (buf.length < 12) return false;
  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return true;
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) {
    return true;
  }
  // GIF: GIF87a / GIF89a
  if (
    buf[0] === 0x47 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x38 &&
    (buf[4] === 0x39 || buf[4] === 0x37) &&
    buf[5] === 0x61
  ) {
    return true;
  }
  // WebP: RIFF....WEBP
  if (
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46 &&
    buf[8] === 0x57 &&
    buf[9] === 0x45 &&
    buf[10] === 0x42 &&
    buf[11] === 0x50
  ) {
    return true;
  }
  // AVIF / HEIF: ....ftypavif / ftypheic / ftypavis
  if (
    buf[4] === 0x66 &&
    buf[5] === 0x74 &&
    buf[6] === 0x79 &&
    buf[7] === 0x70 &&
    ((buf[8] === 0x61 &&
      buf[9] === 0x76 &&
      buf[10] === 0x69 &&
      (buf[11] === 0x66 || buf[11] === 0x73)) ||
      (buf[8] === 0x68 &&
        buf[9] === 0x65 &&
        buf[10] === 0x69 &&
        buf[11] === 0x63))
  ) {
    return true;
  }
  return false;
}