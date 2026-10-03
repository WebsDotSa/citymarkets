/**
 * Image utility functions for WebP serving with fallback
 *
 * Handles:
 * - WebP detection and serving
 * - Fallback to original format for older browsers
 * - Image path transformation
 */

/**
 * Convert image URL to WebP format
 * - /images/product.png → /images/product.webp
 * - /images/product.jpg → /images/product.webp
 * - /images/product.webp → /images/product.webp (no change)
 */
export function getWebPUrl(url: string): string {
  if (!url) return url;

  // Already WebP
  if (url.endsWith('.webp')) return url;

  // Convert to WebP
  return url.replace(/\.(png|jpg|jpeg)$/i, '.webp');
}

/**
 * Get original URL (fallback)
 * Keep original format for older browsers that don't support WebP
 */
export function getOriginalUrl(url: string): string {
  return url;
}

/**
 * Check if WebP is supported by browser
 * Note: This is a static check. For runtime, use feature detection.
 */
export function supportsWebP(): boolean {
  if (typeof window === 'undefined') return true; // Server-side: assume support

  try {
    const canvas = document.createElement('canvas');
    return canvas.toDataURL('image/webp').includes('image/webp');
  } catch {
    return false;
  }
}

/**
 * Generate responsive image srcset with WebP + fallback
 *
 * Example:
 *   srcSetWebP="/images/product.webp 1x, /images/product.webp 2x"
 *   srcSetFallback="/images/product.png 1x, /images/product.png 2x"
 */
export function generateSrcSet(baseUrl: string, sizes: number[] = [1, 2]): {
  webp: string;
  fallback: string;
} {
  const webpUrl = getWebPUrl(baseUrl);
  const fallbackUrl = getOriginalUrl(baseUrl);

  return {
    webp: sizes.map((size) => `${webpUrl} ${size}x`).join(', '),
    fallback: sizes.map((size) => `${fallbackUrl} ${size}x`).join(', '),
  };
}

/**
 * Picture element markup for WebP with fallback
 * For components that need fine-grained control over image serving
 */
export interface PictureImageProps {
  src: string;
  alt: string;
  width?: number;
  height?: number;
  className?: string;
  loading?: 'lazy' | 'eager';
}

/**
 * Generate picture element HTML for WebP + fallback
 * Note: Prefer Next.js Image component instead. This is for fallback cases.
 */
export function generatePictureHTML({
  src,
  alt,
  width,
  height,
  className = '',
  loading = 'lazy',
}: PictureImageProps): string {
  const webpSrc = getWebPUrl(src);
  const fallbackSrc = getOriginalUrl(src);

  const imgAttrs = [
    `src="${fallbackSrc}"`,
    `alt="${alt}"`,
    loading === 'lazy' ? 'loading="lazy"' : 'loading="eager"',
    className ? `class="${className}"` : '',
    width ? `width="${width}"` : '',
    height ? `height="${height}"` : '',
  ]
    .filter(Boolean)
    .join(' ');

  return `
    <picture>
      <source srcset="${webpSrc}" type="image/webp">
      <img ${imgAttrs}>
    </picture>
  `.trim();
}
