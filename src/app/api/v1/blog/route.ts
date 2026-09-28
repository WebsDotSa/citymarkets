import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { cache, CACHE_KEYS, CACHE_TTL } from '@/lib/cache';
import { requireAdminApi } from '@/lib/admin-api-auth';
import { sanitizeHtml } from '@/lib/sanitize-html';

import { error as logError, warn as logWarn, info as logInfo } from '@/lib/logger';
import type { BlogPost } from '@/lib/types';

export const dynamic = 'force-dynamic';

// GET /api/v1/blog - Get all published posts
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const category = searchParams.get('category');
    const featured = searchParams.get('featured');
    const limit = Math.min(50, parseInt(searchParams.get('limit') || '10', 10));
    const offset = (parseInt(searchParams.get('page') || '1', 10) - 1) * limit;

    // Cache key based on params
    const cacheKey = `blog:list:${category || 'all'}:${featured || 'no'}:${limit}:${offset}`;

    // Try cache
    const cached = cache.get<{ posts: BlogPost[]; total: number }>(cacheKey);
    if (cached) {
      return NextResponse.json({
        success: true,
        data: cached.posts,
        total: cached.total,
        cached: true,
      });
    }

    let whereClause = "WHERE status = 'published'";
    const params: (string | number)[] = [];
    let paramIndex = 1;

    if (category) {
      whereClause += ` AND category = $${paramIndex}`;
      params.push(category);
      paramIndex++;
    }

    if (featured === 'true') {
      whereClause += ' AND is_featured = TRUE';
    }

    // Get total count
    const countResult = await query(
      `SELECT COUNT(*) as total FROM blog_posts ${whereClause}`,
      params
    );
    const total = parseInt(countResult.rows[0].total, 10);

    // Get posts
    const result = await query(
      `SELECT id, title_ar, title_en, slug, excerpt_ar, excerpt_en, image_url,
              category, author_name, published_at, view_count, is_featured
       FROM blog_posts
       ${whereClause}
       ORDER BY is_featured DESC, published_at DESC
       LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      [...params, limit, offset]
    );

    const data = { posts: result.rows as BlogPost[], total };

    // Cache for 5 minutes
    cache.set(cacheKey, data, CACHE_TTL.MEDIUM);

    return NextResponse.json({
      success: true,
      data: result.rows,
      total,
      pagination: {
        page: Math.floor(offset / limit) + 1,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    logError('Blog GET error:', error);
    return NextResponse.json(
      { success: false, error: 'فشل جلب المقالات' },
      { status: 500 }
    );
  }
}

// POST /api/v1/blog - Create new post (admin only)
export async function POST(request: NextRequest) {
  try {
    const gate = await requireAdminApi(request, "manage_banners");
    if (gate instanceof NextResponse) return gate;

    const body = await request.json();
    const {
      title_ar, title_en, slug, excerpt_ar, excerpt_en,
      content_ar, content_en, image_url, category, tags,
      author_name, status, is_featured
    } = body;

    if (!title_ar || !slug || !content_ar) {
      return NextResponse.json(
        { success: false, error: 'الاسم والمحتوى مطلوبان' },
        { status: 400 }
      );
    }

    const isPublished = status === 'published' ? true : false;
    const isFeatured = is_featured ? true : false;

    // SECURITY (F9): sanitize HTML content on write. The page renders
    // content_ar via dangerouslySetInnerHTML, and the proxy's CSP blocks
    // classic payloads but not javascript: URIs or older WebView bypasses.
    // sanitizeHtml strips dangerous tags, event handlers, and dangerous
    // URI protocols at the boundary so they can never reach the DOM.
    const sanitizedContentAr = sanitizeHtml(content_ar);
    const sanitizedContentEn = content_en ? sanitizeHtml(content_en) : null;

    const result = await query(
      `INSERT INTO blog_posts
        (title_ar, title_en, slug, excerpt_ar, excerpt_en, content_ar, content_en,
         image_url, category, tags, author_name, status, published_at, is_featured)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
               CASE WHEN $13::boolean THEN NOW() ELSE NULL END,
               $14::boolean)
       RETURNING id, slug`,
      [
        title_ar, title_en || null, slug, excerpt_ar || null, excerpt_en || null,
        sanitizedContentAr, sanitizedContentEn, image_url || null, category || null,
        tags || null, author_name || null, status || 'draft',
        isPublished, isFeatured
      ]
    );

    // Invalidate cache
    cache.invalidatePattern('blog:');

    return NextResponse.json({
      success: true,
      data: result.rows[0],
    });
  } catch (error) {
    logError('Blog POST error:', error);
    return NextResponse.json(
      { success: false, error: 'فشل إنشاء المقال' },
      { status: 500 }
    );
  }
}
