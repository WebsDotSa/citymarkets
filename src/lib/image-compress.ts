/**
 * Client-side image compression helper used by admin upload components.
 *
 * Why this exists:
 *   Camera/HEIC exports are typically 5–10 MB and would exceed the
 *   30 s client-side fetch timeout on slow connections — admin users
 *   were seeing "Upload timeout" even though the server processed the
 *   same upload in <2 s. Resizing to 1920px on the longest edge and
 *   re-encoding as JPEG at 0.82 quality typically shrinks a phone photo
 *   to ~300 KB without visible loss, which keeps the upload comfortably
 *   under the timeout and slashes R2 storage on the server side.
 *
 * Used by:
 *   - src/components/admin/image-uploader.tsx (single image)
 *   - src/components/admin/product-edit-form.tsx (gallery uploader)
 *
 * Pure browser API — no dependency. Falls back to the original File on
 * any decode/encode error so the downstream magic-byte validator can
 * surface a meaningful error instead of silently dropping the upload.
 */

/**
 * Maximum dimension (longest edge) for the resized image. 1920px is
 * enough for any banner/hero card on the storefront — Next.js
 * `<Image>` emits srcset entries up to 1920 width, so going higher
 * wastes bandwidth with no visible benefit.
 */
const MAX_DIMENSION = 1920;

/**
 * JPEG quality used by canvas.toBlob. 0.82 is the sweet spot for
 * product photos — indistinguishable from the original at typical
 * catalog sizes while shrinking PNG/JPEG exports by ~70 %.
 */
const COMPRESS_QUALITY = 0.82;

const COMPRESSIBLE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

/**
 * Resize an uploaded image to fit within `MAX_DIMENSION` on its longest
 * edge and re-encode it as JPEG. Skips work for files already under
 * 512 KB or for non-raster types (SVG / animated WebP/GIF) where the
 * canvas pipeline would lose fidelity.
 *
 * Returns the original File when no work was done so callers can keep
 * using `file.name` / `file.type` unchanged.
 */
export async function compressImageForUpload(file: File): Promise<File> {
  // Already small — nothing to gain from a re-encode.
  if (file.size < 512 * 1024) return file;

  // Canvas can't safely re-encode these without losing content.
  if (!COMPRESSIBLE_TYPES.has(file.type)) return file;

  let bitmap: ImageBitmap | HTMLImageElement;
  try {
    if (typeof createImageBitmap === "function") {
      bitmap = await createImageBitmap(file);
    } else {
      bitmap = await loadHtmlImage(file);
    }
  } catch {
    // Source isn't decodable — let the server-side magic-byte check
    // reject it with a clearer error than we can produce here.
    return file;
  }

  const srcW = "width" in bitmap ? bitmap.width : 0;
  const srcH = "height" in bitmap ? bitmap.height : 0;
  if (!srcW || !srcH) return file;

  const longest = Math.max(srcW, srcH);
  const scale = longest > MAX_DIMENSION ? MAX_DIMENSION / longest : 1;
  const dstW = Math.round(srcW * scale);
  const dstH = Math.round(srcH * scale);

  // No resize needed AND it's already JPEG — keep the original bytes.
  if (scale === 1 && file.type === "image/jpeg") {
    if ("close" in bitmap && typeof bitmap.close === "function") bitmap.close();
    return file;
  }

  const canvas = document.createElement("canvas");
  canvas.width = dstW;
  canvas.height = dstH;
  const ctx2d = canvas.getContext("2d");
  if (!ctx2d) {
    if ("close" in bitmap && typeof bitmap.close === "function") bitmap.close();
    return file;
  }
  ctx2d.imageSmoothingEnabled = true;
  ctx2d.imageSmoothingQuality = "high";
  ctx2d.drawImage(bitmap as CanvasImageSource, 0, 0, dstW, dstH);
  if ("close" in bitmap && typeof bitmap.close === "function") bitmap.close();

  const blob: Blob = await new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("canvas.toBlob returned null"))),
      "image/jpeg",
      COMPRESS_QUALITY,
    );
  });

  // Preserve filename minus the original extension so the server-side
  // magic-byte validator (which already trusts the validated mimetype
  // over the extension) and the user's file list stay consistent.
  const baseName = file.name.replace(/\.[^.]+$/, "");
  return new File([blob], `${baseName}.jpg`, { type: "image/jpeg" });
}

function loadHtmlImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("image decode failed"));
    };
    img.src = url;
  });
}