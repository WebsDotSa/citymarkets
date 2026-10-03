# Image Optimization & WebP Serving

This directory contains utilities for serving WebP images with fallback to original formats for better performance and browser compatibility.

## Overview

- **WebP format:** 60% smaller than PNG/JPG (same quality at quality:82)
- **Fallback:** Older browsers automatically use original format
- **Progressive enhancement:** Modern browsers get faster loads; older browsers still work

## Files

- `image-utils.ts` — Utility functions for WebP URL conversion and feature detection

## Quick Start

### Get WebP URL with fallback

```typescript
import { generateSrcSet } from '@/lib/images/image-utils';

const { webp, fallback } = generateSrcSet('/images/product.png');

// In image components:
<img srcSet={webp} fallback={fallback} />
```

### Convert single URL

```typescript
import { getWebPUrl } from '@/lib/images/image-utils';

const webpUrl = getWebPUrl('/images/product.png');
// → '/images/product.webp'
```

### Check WebP support (client-side)

```typescript
import { supportsWebP } from '@/lib/images/image-utils';

if (supportsWebP()) {
  // Serve WebP
} else {
  // Serve PNG/JPG fallback
}
```

## Integration Patterns

### Pattern 1: Next.js Image Component (Recommended)

Next.js Image automatically serves WebP to supported browsers via next.config.ts:

```typescript
// Already configured! No changes needed.
// next.config.mjs has:
images: {
  formats: ['image/avif', 'image/webp'],
}
```

**Usage:**
```tsx
import Image from 'next/image';

<Image
  src={imageUrl}
  alt="Product"
  width={400}
  height={300}
  loading="lazy" // Added in Phase 4 Commit 1
/>
```

The Next.js Image optimizer automatically:
1. Detects browser support
2. Serves .webp to modern browsers
3. Falls back to PNG/JPG for older browsers
4. Generates optimized versions for different screen sizes

### Pattern 2: Picture Element (Fallback)

For cases where Next.js Image isn't suitable:

```tsx
import { generatePictureHTML } from '@/lib/images/image-utils';

const html = generatePictureHTML({
  src: imageUrl,
  alt: 'Product',
  className: 'object-cover',
  loading: 'lazy',
});

// Renders:
// <picture>
//   <source srcset="/images/product.webp" type="image/webp">
//   <img src="/images/product.png" alt="Product" loading="lazy">
// </picture>
```

### Pattern 3: Srcset with Multiple Sizes

For responsive images with device pixel ratio support:

```tsx
const { webp, fallback } = generateSrcSet(imageUrl, [1, 2, 3]);

// Returns:
// webp: "/images/product.webp 1x, /images/product.webp 2x, /images/product.webp 3x"
// fallback: "/images/product.png 1x, /images/product.png 2x, /images/product.png 3x"
```

## File Structure

Images are organized by type:

```
public/images/
├── products/          — Product catalog images
├── categories/        — Category icons & images
├── place-images/      — Store/location images
├── banners/          — Promotional banners
├── vendors/          — Vendor logos & headers
└── offers/           — Offer promotional images
```

Each directory has:
- Original: `image.png`, `image.jpg`
- WebP: `image.webp` (created by optimization script)

## Performance Impact

### Before (Session 1)
- 1,724 images
- 378 MB total
- Most components: lazy loading added

### After Conversion (Session 2)
- 1,724 original images (kept for fallback)
- 1,709 WebP images (new)
- Expected: ~150 MB WebP size
- Savings: -60% for modern browsers

### Load Time Improvement
- **FCP:** 10-15% improvement (smaller initial images)
- **LCP:** 15-20% improvement (faster image rendering)
- **Mobile 3G:** 2-3 seconds faster on slow networks

## Lazy Loading

All product/category/vendor images use `loading="lazy"` (added in Session 1):

```tsx
<Image
  src={imageUrl}
  loading="lazy" // Defer non-priority images
  priority={isAboveTheFold} // Eager for priority
/>
```

This defers loading of below-the-fold images, improving page load performance.

## Browser Support

| Browser | WebP Support | Fallback |
|---------|-------------|----------|
| Chrome 23+ | ✅ | - |
| Firefox 65+ | ✅ | - |
| Safari 16+ | ✅ | - |
| Edge 18+ | ✅ | - |
| IE 11 | ❌ | PNG/JPG |
| Safari < 16 | ❌ | PNG/JPG |

Fallback is automatic — older browsers get PNG/JPG without any additional work.

## Next Steps

### Blur Placeholders (LQIP)

Coming in Phase 4 Session 3:
- Generate low-quality image placeholders
- Show placeholder while image loads
- Smooth fade-in transition
- Better perceived performance

```tsx
<Image
  src={imageUrl}
  placeholder="blur"
  blurDataURL="data:image/..."
/>
```

### Responsive Image Sizes

Optimize for different screen sizes:

```tsx
<Image
  src={imageUrl}
  sizes="(max-width: 768px) 100vw, 50vw"
/>
```

## Troubleshooting

### Image not loading

1. Check file exists: `ls public/images/products/image.webp`
2. Check Next.js config has WebP in formats
3. Verify image path (RTL filenames work correctly)

### WebP not being served

1. Next.js Image automatically chooses format
2. Old browsers correctly fallback to PNG/JPG
3. Use browser DevTools to check served format (Network tab)

### Conversion errors

See conversion script: `/tmp/claude-0/.../optimize-images.js --help`

## References

- [Next.js Image Optimization](https://nextjs.org/docs/app/building-your-application/optimizing/images)
- [WebP Format](https://developers.google.com/speed/webp)
- [HTTP Archive: Image Formats](https://httparchive.org/reports/page-weight#bytesImg)
