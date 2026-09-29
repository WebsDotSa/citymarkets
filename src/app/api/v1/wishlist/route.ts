import { NextRequest, NextResponse } from 'next/server';
import { resolveCustomerUserIdFromRequest } from '@/lib/identity';
import {
  addToWishlist,
  clearWishlist,
  listWishlist,
  removeFromWishlist,
} from '@/lib/identity/wishlist-service';
import { error as logError } from '@/lib/logger';
import {
  checkRateLimit,
  createRateLimitHeaders,
  CART_OPERATION_CONFIG,
  GENERAL_API_CONFIG,
} from '@/lib/rate-limit';

// GET /api/v1/wishlist - List the current user's wishlist
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
    const items = await listWishlist(userId);
    return NextResponse.json(
      { success: true, data: items, count: items.length },
      { headers: createRateLimitHeaders(rl) }
    );
  } catch (error) {
    logError('wishlist list error', error);
    return NextResponse.json(
      { success: false, error: 'فشل جلب المفضلة' },
      { status: 500 }
    );
  }
}

// POST /api/v1/wishlist - Add a product to the wishlist
// body: { product_id: string }
export async function POST(request: NextRequest) {
  const userId = await resolveCustomerUserIdFromRequest(request);
  if (!userId) {
    return NextResponse.json(
      { success: false, error: 'غير مصرح' },
      { status: 401 }
    );
  }

  const rl = await checkRateLimit(`wishlist:${userId}`, CART_OPERATION_CONFIG);
  if (!rl.allowed) {
    return NextResponse.json(
      { success: false, error: 'تم تجاوز عدد المحاولات، حاول لاحقاً' },
      { status: 429, headers: createRateLimitHeaders(rl) }
    );
  }

  try {
    const body = await request.json();
    const productId = typeof body?.product_id === 'string' ? body.product_id : null;
    if (!productId) {
      return NextResponse.json(
        { success: false, error: 'معرّف المنتج مطلوب' },
        { status: 400 }
      );
    }

    const result = await addToWishlist(userId, productId);
    if (!result.ok) {
      const status = result.reason === 'full' ? 409 : 200;
      return NextResponse.json(
        {
          success: false,
          reason: result.reason,
          error:
            result.reason === 'full'
              ? 'وصلت المفضلة للحد الأقصى (50 منتج)'
              : 'المنتج موجود بالفعل في المفضلة',
        },
        { status, headers: createRateLimitHeaders(rl) }
      );
    }

    return NextResponse.json(
      { success: true, data: result.item },
      { headers: createRateLimitHeaders(rl) }
    );
  } catch (error) {
    logError('wishlist add error', error);
    return NextResponse.json(
      { success: false, error: 'فشل إضافة المنتج للمفضلة' },
      { status: 500 }
    );
  }
}

// DELETE /api/v1/wishlist?product_id=xxx - Remove a product
// DELETE /api/v1/wishlist (no body) - Clear all
export async function DELETE(request: NextRequest) {
  const userId = await resolveCustomerUserIdFromRequest(request);
  if (!userId) {
    return NextResponse.json(
      { success: false, error: 'غير مصرح' },
      { status: 401 }
    );
  }

  const rl = await checkRateLimit(`wishlist:${userId}`, CART_OPERATION_CONFIG);
  if (!rl.allowed) {
    return NextResponse.json(
      { success: false, error: 'تم تجاوز عدد المحاولات، حاول لاحقاً' },
      { status: 429, headers: createRateLimitHeaders(rl) }
    );
  }

  try {
    const url = new URL(request.url);
    const productId = url.searchParams.get('product_id');

    if (!productId) {
      const removed = await clearWishlist(userId);
      return NextResponse.json(
        { success: true, removed },
        { headers: createRateLimitHeaders(rl) }
      );
    }

    const removed = await removeFromWishlist(userId, productId);
    return NextResponse.json(
      { success: true, removed },
      { headers: createRateLimitHeaders(rl) }
    );
  } catch (error) {
    logError('wishlist remove error', error);
    return NextResponse.json(
      { success: false, error: 'فشل حذف المنتج من المفضلة' },
      { status: 500 }
    );
  }
}
