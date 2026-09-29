import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { requireAdminApi } from '@/lib/identity';
import { error as logError } from '@/lib/logger';
import type { AdminAbandonedCart } from '@/lib/admin-types';

type AbandonedCartRow = AdminAbandonedCart;

/**
 * GET /api/admin/abandoned-carts
 *
 * Query params (all optional):
 *   - status: 'abandoned' | 'recovered'   (omit for both)
 *   - search: substring match against guest_name / guest_phone / user name
 *   - page:   1-based page number, default 1
 *   - limit:  1..100, default 20
 *
 * Returns { data, pagination: { page, limit, total, totalPages } }.
 */
export async function GET(request: NextRequest) {
  const gate = await requireAdminApi(request, 'manage_orders');
  if (gate instanceof NextResponse) return gate;

  try {
    const { searchParams } = new URL(request.url);
    const status = (searchParams.get('status') ?? '').trim();
    const search = (searchParams.get('search') ?? '').trim();
    const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') ?? '20', 10)));
    const offset = (page - 1) * limit;

    const allowedStatuses = ['abandoned', 'recovered'];
    const safeStatus = allowedStatuses.includes(status) ? status : '';

    const conditions: string[] = [];
    const params: (string | number)[] = [];
    let pi = 1;
    if (safeStatus) {
      conditions.push(`ac.status = $${pi++}`);
      params.push(safeStatus);
    }
    if (search) {
      conditions.push(
        `(ac.guest_name ILIKE $${pi} OR ac.guest_phone ILIKE $${pi} OR u.name ILIKE $${pi} OR u.phone ILIKE $${pi} OR ac.id::text ILIKE $${pi} OR ac.intent_order_id::text ILIKE $${pi})`,
      );
      params.push(`%${search}%`);
      pi++;
    }
    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countRes = await query<{ total: string }>(
      `SELECT COUNT(*)::text AS total
         FROM abandoned_carts ac
         LEFT JOIN users u ON u.id = ac.user_id
         ${whereClause}`,
      params,
    );
    const total = parseInt(countRes.rows[0]?.total ?? '0', 10);

    const listParams = [...params, limit, offset];
    const result = await query<AbandonedCartRow>(
      `SELECT ac.id, ac.user_id::text AS user_id,
              ac.guest_session_id, ac.guest_name, ac.guest_phone,
              ac.items_count, ac.subtotal::float AS subtotal, ac.items,
              ac.intent_order_id::text AS intent_order_id,
              ac.status, ac.recovered_order_id::text AS recovered_order_id,
              ac.last_seen_at, ac.created_at,
              u.name AS user_name, u.phone AS user_phone
         FROM abandoned_carts ac
         LEFT JOIN users u ON u.id = ac.user_id
         ${whereClause}
         ORDER BY ac.last_seen_at DESC
         LIMIT $${pi++} OFFSET $${pi++}`,
      listParams,
    );

    return NextResponse.json({
      success: true,
      data: result.rows,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    });
  } catch (error) {
    logError('Admin abandoned-carts list error:', error);
    return NextResponse.json(
      { success: false, error: 'فشل جلب السلات المتروكة' },
      { status: 500 },
    );
  }
}
