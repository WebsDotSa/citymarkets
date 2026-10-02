import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { resolveCustomerUserIdFromRequest } from '@/lib/identity';

import { error as logError } from '@/lib/logger';
import { parsePagination } from "@/lib/api/pagination";
import { checkRateLimit, REVIEW_SUBMIT_IP_CONFIG } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/request-ip";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const productId = searchParams.get('productId');
  const mine = searchParams.get('mine') === '1';
  const { limit, page, offset } = parsePagination(searchParams, { defaultLimit: 20 });

  // P2-12 (PCP-101 audit): reject non-UUID productId before opening a DB
  // connection — Postgres would otherwise throw "invalid input syntax for
  // type uuid" and the route would 500 instead of 400. Applies only to
  // the productId branch; the "mine" branch doesn't filter by product.
  if (productId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(productId)) {
    return NextResponse.json(
      { error: "معرّف المنتج غير صالح" },
      { status: 400 },
    );
  }

  const client = await pool.connect();

  try {
    if (mine) {
      // `/profile/reviews` needs the caller's reviews joined with the
      // product name + image so the page can render thumbnails. The
      // existing idx_product_reviews_user (user_id, created_at DESC)
      // index covers this path.
      const userId = await resolveCustomerUserIdFromRequest(request);
      if (!userId) {
        return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });
      }
      const result = await client.query(
        `SELECT pr.id, pr.product_id, pr.user_id, pr.rating, pr.comment,
                pr.is_verified_purchase, pr.is_approved, pr.created_at, pr.updated_at,
                p.name_ar AS product_name,
                p.image_url AS product_image
           FROM product_reviews pr
           LEFT JOIN products_unified p ON pr.product_id = p.id
          WHERE pr.user_id = $1
          ORDER BY pr.created_at DESC
          LIMIT $2`,
        [userId, limit],
      );
      return NextResponse.json({ success: true, reviews: result.rows });
    }

    let reviews: any[] = [];
    let avgRating: number | null = null;
    let totalReviews = 0;

    if (productId) {
      const result = await client.query(
        `SELECT pr.id, pr.product_id, pr.user_id, pr.rating, pr.comment,
                pr.is_verified_purchase, pr.created_at,
                u.name AS user_name
         FROM product_reviews pr
         LEFT JOIN users u ON pr.user_id = u.id
         WHERE pr.product_id = $1 AND pr.is_approved = true
         ORDER BY pr.created_at DESC
         LIMIT $2`,
        [productId, limit]
      );
      reviews = result.rows;

      const stats = await client.query(
        `SELECT AVG(rating)::numeric(3,2) AS avg, COUNT(*) AS count
         FROM product_reviews
         WHERE product_id = $1 AND is_approved = true`,
        [productId]
      );
      if (Number(stats.rows[0].count) > 0) {
        avgRating = parseFloat(stats.rows[0].avg);
        totalReviews = parseInt(stats.rows[0].count, 10);
      }
    } else {
      // No productId and not ?mine=1: 400 (this endpoint is product-scoped
      // unless the caller is fetching their own reviews).
      return NextResponse.json(
        { error: 'productId أو mine=1 مطلوب' },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      reviews,
      avgRating,
      totalReviews,
    });

  } catch (error) {
    logError('Reviews GET error:', error);
    return NextResponse.json({ error: 'حدث خطأ' }, { status: 500 });
  } finally {
    client.release();
  }
}

export async function POST(request: NextRequest) {
  // SECURITY (PCP-125): rate limit review submission by IP. The
  // REVIEW_SUBMIT_IP_CONFIG (5/min) was added in Phase 2 but the
  // route was never wired to call it. Without this, an attacker can
  // flood product_reviews with fake reviews from a single IP.
  const clientIp = getClientIp(request);
  const ipLimit = await checkRateLimit(clientIp, REVIEW_SUBMIT_IP_CONFIG);
  if (!ipLimit.allowed) {
    return NextResponse.json(
      { error: 'تجاوزت عدد التقييمات المسموح بها. حاول بعد دقيقة.' },
      { status: 429 }
    );
  }

  const userId = await resolveCustomerUserIdFromRequest(request);
  if (!userId) {
    return NextResponse.json(
      { error: 'يجب تسجيل الدخول لإضافة تقييم' },
      { status: 401 }
    );
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON غير صالح' }, { status: 400 });
  }

  const productId = body?.productId;
  const rating = Number(body?.rating);
  const comment = typeof body?.comment === 'string' ? body.comment.trim() : null;

  if (!productId || !rating || rating < 1 || rating > 5) {
    return NextResponse.json(
      { error: 'بيانات غير مكتملة أو التقييم خارج النطاق' },
      { status: 400 }
    );
  }

  const client = await pool.connect();
  try {
    // Verified-purchase flag: only mark true if a delivered order contains this product.
    const ordered = await client.query(
      `SELECT 1 FROM orders o
       JOIN order_items oi ON o.id = oi.order_id
       WHERE o.user_id = $1 AND oi.product_id = $2
         AND o.status IN ('completed', 'delivered')
       LIMIT 1`,
      [userId, productId]
    );
    const isVerified = ordered.rows.length > 0;

    // Upsert: one review per (user, product). Editing replaces the comment.
    const result = await client.query(
      `INSERT INTO product_reviews
         (product_id, user_id, rating, comment, is_verified_purchase, is_approved)
       VALUES ($1, $2, $3, $4, $5, true)
       ON CONFLICT (user_id, product_id) DO UPDATE
         SET rating = EXCLUDED.rating,
             comment = EXCLUDED.comment,
             is_verified_purchase = EXCLUDED.is_verified_purchase,
             updated_at = now()
       RETURNING id`,
      [productId, userId, rating, comment, isVerified]
    );

    return NextResponse.json({
      success: true,
      message: 'تم إضافة تقييمك',
      reviewId: result.rows[0].id,
      isVerifiedPurchase: isVerified,
    });
  } catch (error) {
    logError('Add review error:', error);
    return NextResponse.json({ error: 'حدث خطأ' }, { status: 500 });
  } finally {
    client.release();
  }
}

/**
 * DELETE /api/v1/reviews?id=<reviewId>
 *
 * Lets a user retract their own review. We enforce ownership in the
 * WHERE clause so users can never delete someone else's row even if
 * they guess an id.
 */
export async function DELETE(request: NextRequest) {
  const userId = await resolveCustomerUserIdFromRequest(request);
  if (!userId) {
    return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });
  }

  const id = new URL(request.url).searchParams.get('id');
  if (!id) {
    return NextResponse.json({ error: 'معرّف التقييم مطلوب' }, { status: 400 });
  }

  const client = await pool.connect();
  try {
    const result = await client.query(
      `DELETE FROM product_reviews WHERE id = $1 AND user_id = $2`,
      [id, userId],
    );
    if (result.rowCount === 0) {
      return NextResponse.json(
        { error: 'التقييم غير موجود أو لا يخصك' },
        { status: 404 },
      );
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    logError('Review DELETE error:', error);
    return NextResponse.json({ error: 'حدث خطأ' }, { status: 500 });
  } finally {
    client.release();
  }
}
