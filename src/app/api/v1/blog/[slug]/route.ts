import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { cache, CACHE_KEYS, CACHE_TTL } from '@/lib/cache';

import { error as logError, warn as logWarn, info as logInfo } from '@/lib/logger';
import type { BlogPost } from '@/lib/types';
import {
  BLOG_VIEW_IP_CONFIG,
  checkRateLimit,
  createRateLimitHeaders,
} from '@/lib/rate-limit';
import { getClientIp } from '@/lib/request-ip';

export const dynamic = 'force-dynamic';

// GET /api/v1/blog/[slug]
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  // SECURITY: view_count UPDATE is the abuse target — bots can skew
  // editorial metrics by inflating view counts. IP rate limit (60/min)
  // is well above human read speed but cuts scripted floods. Cached
  // responses also short-circuit the counter for legitimate readers.
  const ip = getClientIp(request);
  const rl = await checkRateLimit(ip, BLOG_VIEW_IP_CONFIG);
  if (!rl.allowed) {
    return NextResponse.json(
      { success: false, error: 'تجاوزت الحد المسموح من طلبات القراءة' },
      { status: 429, headers: createRateLimitHeaders(rl) },
    );
  }

  try {
    const { slug } = await params;
    const cacheKey = `blog:post:${slug}`;

    // Try cache
    const cached = cache.get<BlogPost>(cacheKey);
    if (cached) {
      return NextResponse.json({ success: true, data: cached, cached: true });
    }

    const result = await query(
      `SELECT id, title_ar, title_en, slug, excerpt_ar, excerpt_en,
              content_ar, content_en, image_url, category, tags,
              author_name, published_at, view_count, is_featured,
              meta_title, meta_description
       FROM blog_posts
       WHERE slug = $1 AND status = 'published'`,
      [slug]
    );

    if (result.rows.length === 0) {
      return NextResponse.json(
        { success: false, error: 'المقال غير موجود' },
        { status: 404 }
      );
    }

    const post = result.rows[0] as BlogPost;

    // Increment view count (async, don't wait)
    query(
      'UPDATE blog_posts SET view_count = view_count + 1 WHERE id = $1',
      [post.id]
    ).catch(() => {});

    // Cache for 10 minutes
    cache.set(cacheKey, post, CACHE_TTL.LONG);

    return NextResponse.json({ success: true, data: post });
  } catch (error) {
    logError('Blog post GET error:', error);
    return NextResponse.json(
      { success: false, error: 'فشل جلب المقال' },
      { status: 500 }
    );
  }
}
