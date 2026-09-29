import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { requireAdminApi } from '@/lib/identity';
import { error as logError } from '@/lib/logger';

/**
 * GET /api/admin/orders/direct
 *
 * Lists all type='direct' orders with chat unread counts.
 */
export async function GET(request: NextRequest) {
  const gate = await requireAdminApi(request, 'manage_orders');
  if (gate instanceof NextResponse) return gate;

  const url = new URL(request.url);
  const status = url.searchParams.get('status') || '';
  const search = url.searchParams.get('search') || '';
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10), 200);
  const offset = Math.max(parseInt(url.searchParams.get('offset') || '0', 10), 0);

  const client = await pool.connect();
  try {
    const where: string[] = [`o.type = 'direct'`];
    const params: unknown[] = [];
    if (status) {
      params.push(status);
      where.push(`o.status = $${params.length}`);
    }
    if (search) {
      params.push(`%${search}%`);
      where.push(`(o.tracking_code ILIKE $${params.length} OR o.guest_name ILIKE $${params.length} OR u.name ILIKE $${params.length})`);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const res = await client.query(
      `SELECT o.id, o.tracking_code AS order_number, o.status, o.total::float, o.service_fee::float, o.tax::float,
              o.payment_method, o.payment_status, o.created_at, o.updated_at,
              o.guest_name, o.guest_phone,
              u.name as user_name, u.phone as user_phone,
              a.label as address_label, a.address_text,
              COALESCE((
                SELECT COUNT(*) FROM direct_order_messages m
                WHERE m.order_id = o.id AND m.sender_type = 'customer' AND m.read_by_admin_at IS NULL
              ), 0) AS unread_count,
              COALESCE((
                SELECT COUNT(*) FROM direct_order_items WHERE order_id = o.id
              ), 0) AS items_count
       FROM orders o
       LEFT JOIN users u ON u.id = o.user_id
       LEFT JOIN addresses a ON a.id = o.address_id
       ${whereSql}
       ORDER BY o.created_at DESC
       LIMIT ${limit} OFFSET ${offset}`,
      params
    );
    const totalRes = await client.query(
      `SELECT COUNT(*)::int AS total FROM orders o
       LEFT JOIN users u ON u.id = o.user_id
       ${whereSql}`,
      params
    );
    return NextResponse.json({
      success: true,
      orders: res.rows,
      total: totalRes.rows[0].total,
      limit,
      offset,
    });
  } catch (err) {
    logError('admin direct orders list failed', err);
    return NextResponse.json({ success: false, error: 'تعذر التحميل' }, { status: 500 });
  } finally {
    client.release();
  }
}