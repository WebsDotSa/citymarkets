import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { requireAdminApi } from "@/lib/identity/admin-api-auth-db";
import { error as logError } from '@/lib/logger';
import { orderMessagePostSchema as postBodySchema } from '@/lib/validation';

// Module-scoped UUID validator. P2-9 (PCP-101 audit): same fix as
// /api/admin/orders/[id] — pre-validate before opening a pool
// connection so bad UUIDs surface as 400 not 500.
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET  /api/admin/orders/[id]/messages  → admin reads all messages
 * POST /api/admin/orders/[id]/messages  → admin sends reply
 */
export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const gate = await requireAdminApi(request, 'manage_orders');
  if (gate instanceof NextResponse) return gate;
  const { id: orderId } = await ctx.params;

  if (!UUID_RE.test(orderId)) {
    return NextResponse.json(
      { success: false, error: 'معرّف الطلب غير صالح' },
      { status: 400 }
    );
  }

  const client = await pool.connect();
  try {
    const ord = await client.query(
      `SELECT id, status FROM orders WHERE id = $1 LIMIT 1`,
      [orderId]
    );
    if (ord.rows.length === 0) {
      return NextResponse.json({ success: false, error: 'الطلب غير موجود' }, { status: 404 });
    }
    const res = await client.query(
      `SELECT m.id, m.sender_type, m.sender_user_id::text, m.sender_admin_id::text,
              m.body, m.audio_url, m.audio_duration, m.message_kind,
              m.read_by_customer_at, m.read_by_admin_at, m.created_at,
              au.name as admin_name, u.name as customer_name
       FROM direct_order_messages m
       LEFT JOIN admin_users au ON au.id = m.sender_admin_id
       LEFT JOIN users u ON u.id = m.sender_user_id
       WHERE m.order_id = $1
       ORDER BY m.created_at ASC
       LIMIT 300`,
      [orderId]
    );

    // Mark customer messages as read by admin.
    await client.query(
      `UPDATE direct_order_messages
         SET read_by_admin_at = NOW()
       WHERE order_id = $1
         AND sender_type = 'customer'
         AND read_by_admin_at IS NULL`,
      [orderId]
    );

    return NextResponse.json({
      success: true,
      orderStatus: ord.rows[0].status,
      messages: res.rows,
    });
  } catch (err) {
    logError('admin messages GET failed', err);
    return NextResponse.json({ success: false, error: 'تعذر التحميل' }, { status: 500 });
  } finally {
    client.release();
  }
}

export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const gate = await requireAdminApi(request, 'manage_orders');
  if (gate instanceof NextResponse) return gate;
  const { id: orderId } = await ctx.params;
  const admin = gate.admin;

  if (!UUID_RE.test(orderId)) {
    return NextResponse.json(
      { success: false, error: 'معرّف الطلب غير صالح' },
      { status: 400 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: 'بيانات غير صالحة' }, { status: 400 });
  }
  const parsed = postBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: 'بيانات غير صالحة' },
      { status: 400 }
    );
  }
  if (!parsed.data.body && !parsed.data.audio_url) {
    return NextResponse.json({ success: false, error: 'أرسل نص أو مقطع صوتي' }, { status: 400 });
  }

  const client = await pool.connect();
  try {
    const ord = await client.query(`SELECT id FROM orders WHERE id = $1 LIMIT 1`, [orderId]);
    if (ord.rows.length === 0) {
      return NextResponse.json({ success: false, error: 'الطلب غير موجود' }, { status: 404 });
    }
    const ins = await client.query(
      `INSERT INTO direct_order_messages
        (order_id, sender_type, sender_admin_id, body, audio_url, audio_duration, message_kind)
       VALUES ($1, 'admin', $2, $3, $4, $5, $6)
       RETURNING id, created_at`,
      [
        orderId,
        admin.id,
        parsed.data.body ?? null,
        parsed.data.audio_url || null,
        parsed.data.audio_duration ?? null,
        parsed.data.message_kind,
      ]
    );
    return NextResponse.json(
      { success: true, id: ins.rows[0].id, created_at: ins.rows[0].created_at },
      { status: 201 }
    );
  } catch (err) {
    logError('admin messages POST failed', err);
    return NextResponse.json({ success: false, error: 'تعذر الإرسال' }, { status: 500 });
  } finally {
    client.release();
  }
}