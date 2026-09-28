import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { requireAdminApi } from '@/lib/admin-api-auth';
import { logAdminAction } from '@/lib/admin-audit';
import { error as logError } from '@/lib/logger';
import { orderAdminItemAddSchema } from '@/lib/validation';

/**
 * POST /api/admin/orders/[id]/items
 *
 * Admin adds a NEW line to a direct order. Mirrors the customer-side
 * `POST /api/v1/orders/[id]/items` but:
 *   - uses `requireAdminApi(..., 'manage_orders')` instead of ownership
 *   - allows an optional `unit_price` (admins know the catalog price;
 *     customers always submit 0 because the driver reconciles later)
 *   - inserts a chat message with sender_type='admin' so the customer's
 *     chat panel renders it
 *   - allows adding while status is in [pending, shopping, preparing,
 *     accepted, in_progress, on_the_way] — stricter than customer
 *     side because admins need to fix mistakes mid-flow
 *
 * The DB write is identical to the customer flow (same table:
 * `direct_order_items`), so existing PATCH/DELETE/admin reconciliation
 * logic continues to work without any further changes.
 */
export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const gate = await requireAdminApi(request, 'manage_orders');
  if (gate instanceof NextResponse) return gate;
  const { id: orderId } = await ctx.params;
  const admin = gate.admin;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: 'بيانات غير صالحة' }, { status: 400 });
  }
  const parsed = orderAdminItemAddSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: 'بيانات غير صالحة', details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const data = parsed.data;
  if (!data.product_id && !data.free_text) {
    return NextResponse.json(
      { success: false, error: 'حدد منتج أو اكتب طلبك' },
      { status: 400 }
    );
  }

  const client = await pool.connect();
  try {
    // Confirm the order exists, is a direct order, and is not in a
    // terminal status. Locking the row prevents a concurrent admin
    // flip to `delivered` racing the insert.
    const ord = await client.query(
      `SELECT id, status, type FROM orders WHERE id = $1 FOR UPDATE`,
      [orderId]
    );
    if (ord.rows.length === 0) {
      return NextResponse.json({ success: false, error: 'الطلب غير موجود' }, { status: 404 });
    }
    const o = ord.rows[0];
    if (o.type !== 'direct') {
      return NextResponse.json(
        { success: false, error: 'هذا الإجراء للطلبات المباشرة فقط' },
        { status: 400 }
      );
    }
    if (['delivered', 'cancelled'].includes(o.status)) {
      return NextResponse.json(
        { success: false, error: 'لا يمكن تعديل طلب منتهي' },
        { status: 409 }
      );
    }

    const ins = await client.query(
      `INSERT INTO direct_order_items
        (order_id, product_id, free_text, quantity, unit_price, notes)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [
        orderId,
        data.product_id ?? null,
        data.free_text ?? null,
        data.quantity,
        data.unit_price ?? 0,
        data.notes ?? null,
      ]
    );

    // Mirror customer-side behavior: drop a chat message so both
    // panels (admin + customer) show the change in real time.
    const itemLabel = data.free_text || ('منتج #' + (data.product_id || '').slice(0, 8));
    await client.query(
      `INSERT INTO direct_order_messages
        (order_id, sender_type, sender_admin_id, body, message_kind)
       VALUES ($1, 'admin', $2, $3, 'item_added')`,
      [orderId, admin.id, `أضاف الإدارة عنصراً جديداً: ${itemLabel} ×${data.quantity}`]
    );

    await logAdminAction(admin, 'add_direct_order_item', {
      entityId: orderId,
      details: parsed.data,
    });

    return NextResponse.json(
      { success: true, itemId: ins.rows[0].id },
      { status: 201 }
    );
  } catch (err) {
    logError('admin add direct item failed', {
      err: (err as Error).message,
      orderId,
      adminId: admin.id,
    });
    return NextResponse.json({ success: false, error: 'تعذر الإضافة' }, { status: 500 });
  } finally {
    client.release();
  }
}
