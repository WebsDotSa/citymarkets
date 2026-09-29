import { NextRequest, NextResponse } from 'next/server';
import { resolveCustomerUserIdFromRequest } from '@/lib/identity';
import { isInWishlist, getWishlistMembership } from '@/lib/identity/wishlist-service';
import { error as logError } from '@/lib/logger';
import {
  checkRateLimit,
  createRateLimitHeaders,
  GENERAL_API_CONFIG,
} from '@/lib/rate-limit';

/**
 * GET /api/v1/wishlist/check?product_id=xxx
 *   → { in_wishlist: boolean }
 * GET /api/v1/wishlist/check?product_ids=a,b,c
 *   → { membership: { a: true, b: false, c: true } }
 *
 * Powers the heart icon on product cards. The batch form avoids
 * N+1 queries when the catalog page renders 24 cards.
 */
export async function GET(request: NextRequest) {
  const userId = await resolveCustomerUserIdFromRequest(request);
  if (!userId) {
    return NextResponse.json(
      { success: false, error: 'غير مصرح' },
      { status: 401 }
    );
  }

  const rl = await checkRateLimit(`wishlist:${userId}`, GENERAL_API_CONFIG);
  if (!rl.allowed) {
    return NextResponse.json(
      { success: false, error: 'تم تجاوز عدد المحاولات، حاول لاحقاً' },
      { status: 429, headers: createRateLimitHeaders(rl) }
    );
  }

  try {
    const url = new URL(request.url);
    const productIdsParam = url.searchParams.get('product_ids');
    const single = url.searchParams.get('product_id');

    if (productIdsParam) {
      const ids = productIdsParam
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 100); // hard cap
      const set = await getWishlistMembership(userId, ids);
      const membership: Record<string, boolean> = {};
      for (const id of ids) membership[id] = set.has(id);
      return NextResponse.json(
        { success: true, membership },
        { headers: createRateLimitHeaders(rl) }
      );
    }

    if (!single) {
      return NextResponse.json(
        { success: false, error: 'product_id أو product_ids مطلوب' },
        { status: 400 }
      );
    }

    const present = await isInWishlist(userId, single);
    return NextResponse.json(
      { success: true, in_wishlist: present },
      { headers: createRateLimitHeaders(rl) }
    );
  } catch (error) {
    logError('wishlist check error', error);
    return NextResponse.json(
      { success: false, error: 'فشل التحقق من المفضلة' },
      { status: 500 }
    );
  }
}
