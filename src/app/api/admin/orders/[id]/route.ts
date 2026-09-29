import { NextRequest, NextResponse } from 'next/server';
import { pool, query } from '@/lib/db';
import { requireAdminApi } from "@/lib/identity/admin-api-auth-db";
import { logAdminAction } from '@/lib/admin-audit';
import { error as logError, warn as logWarn } from '@/lib/logger';
import { orderEditSchema } from '@/lib/validation';
import {
  assertValidTransition,
  invalidTransitionMessage,
} from '@/lib/orders/state-machine';
import {
  ORDER_BASE_COLUMNS,
  ORDER_ADDRESS_COLUMNS_MINIMAL,
  ORDER_USER_COLUMNS,
  ORDER_DETAIL_JOINS,
} from '@/lib/orders/sql-fragments';

/**
 * GET /api/admin/orders/[id]
 *
 * Returns full order + items + chat summary for the admin chat hub.
 */
export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const gate = await requireAdminApi(request, 'manage_orders');
  if (gate instanceof NextResponse) return gate;
  const { id: orderId } = await ctx.params;

  try {
    // Reuse the canonical column-list + JOIN fragment so adding a new
    // order-detail column (e.g. scheduled, voice_note_url) only needs an
    // edit in @/lib/orders/sql-fragments instead of every consumer.
    const ord = await query(
      `SELECT ${ORDER_BASE_COLUMNS},
              o.tracking_code AS order_number, o.type,
              ${ORDER_ADDRESS_COLUMNS_MINIMAL},
              ${ORDER_USER_COLUMNS}
       ${ORDER_DETAIL_JOINS}
       WHERE o.id = $1
       LIMIT 1`,
      [orderId]
    );
    if (ord.rows.length === 0) {
      return NextResponse.json({ success: false, error: 'الطلب غير موجود' }, { status: 404 });
    }

    const items = await query(
      `SELECT i.id, i.product_id, p.name_ar, p.image_url, p.price::float,
              i.free_text, i.quantity, i.unit_price::float, i.notes,
              i.resolved_price::float, i.resolved_at, i.resolved_by_admin_id::text
       FROM direct_order_items i
       LEFT JOIN products p ON p.id = i.product_id
       WHERE i.order_id = $1
       ORDER BY i.created_at ASC`,
      [orderId]
    );

    const o = ord.rows[0];
    return NextResponse.json({
      success: true,
      order: {
        id: o.id,
        order_number: o.order_number,
        status: o.status,
        type: o.type,
        subtotal: o.subtotal,
        delivery_fee: o.delivery_fee,
        service_fee: o.service_fee,
        tax: o.tax,
        discount: o.discount,
        total: o.total,
        payment_method: o.payment_method,
        payment_reference: o.payment_reference,
        payment_status: o.payment_status,
        notes: o.notes,
        internal_notes: o.internal_notes,
        created_at: o.created_at,
        updated_at: o.updated_at,
        guest_name: o.guest_name,
        guest_phone: o.guest_phone,
        user_name: o.user_name,
        user_phone: o.user_phone,
        address_label: o.address_label,
        address_text: o.address_text,
      },
      items: items.rows,
    });
  } catch (err) {
    logError('admin order detail GET failed', err);
    return NextResponse.json({ success: false, error: 'تعذر التحميل' }, { status: 500 });
  }
}

/**
 * PATCH /api/admin/orders/[id]
 *
 * Admin updates an order (status flip + direct-item reconciliation).
 */
export async function PATCH(
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
  const parsed = orderEditSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: 'بيانات غير صالحة', details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const ord = await client.query(
      `SELECT id, status, type, total::float, driver_id FROM orders WHERE id = $1 FOR UPDATE`,
      [orderId]
    );
    if (ord.rows.length === 0) {
      return NextResponse.json({ success: false, error: 'الطلب غير موجود' }, { status: 404 });
    }

    // Centralized state-machine guard. Admins get the documented escape
    // hatch (delivered → cancelled); everything else follows the role
    // table in `@/lib/orders/state-machine`.
    if (parsed.data.status) {
      const currentStatus = String(ord.rows[0].status);
      const targetStatus = String(parsed.data.status);
      try {
        assertValidTransition('admin', 'orders', currentStatus, targetStatus);
      } catch (err) {
        await client.query('ROLLBACK');
        const message = invalidTransitionMessage(
          'admin',
          'orders',
          currentStatus,
          targetStatus,
        );
        logWarn('[admin/orders PATCH] rejected invalid transition', {
          orderId,
          from: currentStatus,
          to: targetStatus,
          reason: err instanceof Error ? err.message : String(err),
        });
        return NextResponse.json(
          { success: false, error: message },
          { status: 400 },
        );
      }
    }

    const updates: string[] = [];
    const params: unknown[] = [];
    let pIdx = 1;

    if (parsed.data.status) {
      updates.push(`status = $${pIdx++}`);
      params.push(parsed.data.status);
    }
    if (parsed.data.internal_notes !== undefined) {
      updates.push(`internal_notes = $${pIdx++}`);
      params.push(parsed.data.internal_notes);
    }
    if (parsed.data.final_subtotal !== undefined) {
      updates.push(`subtotal = $${pIdx++}`);
      params.push(parsed.data.final_subtotal);
    }
    if (parsed.data.final_delivery_fee !== undefined) {
      updates.push(`delivery_fee = $${pIdx++}`);
      params.push(parsed.data.final_delivery_fee);
    }

    // Phase 1 / T4: admin assigns / unassigns a delivery driver.
    // The client passes admin_users.id (the same id stored in admin_session
    // JWTs); we resolve to drivers.id here. null = unassign. An inactive
    // admin or an admin without a drivers row is rejected so operators
    // don't silently bind orders to a row that won't render on /admin/driver.
    let driverChange: { oldDriver: string | null; newDriver: string | null } | null = null;
    if (parsed.data.driver_id !== undefined) {
      let resolvedDriverId: string | null = null;
      if (parsed.data.driver_id !== null) {
        const dRes = await client.query(
          `SELECT d.id FROM drivers d
             JOIN admin_users au ON au.id = d.admin_user_id
            WHERE au.id = $1 AND au.is_active = true`,
          [parsed.data.driver_id]
        );
        if (dRes.rows.length === 0) {
          await client.query('ROLLBACK');
          return NextResponse.json(
            { success: false, error: 'المندوب غير موجود أو غير نشط' },
            { status: 400 }
          );
        }
        resolvedDriverId = dRes.rows[0].id;
      }
      driverChange = { oldDriver: ord.rows[0].driver_id, newDriver: resolvedDriverId };
      updates.push(`driver_id = $${pIdx++}`);
      params.push(resolvedDriverId);
    }

    if (updates.length > 0) {
      params.push(orderId);
      await client.query(
        `UPDATE orders SET ${updates.join(', ')}, updated_at = NOW() WHERE id = $${pIdx}`,
        params
      );
    }

    // Reconcile direct items.
    if (parsed.data.items) {
      for (const it of parsed.data.items) {
        if (it.remove) {
          await client.query(`DELETE FROM direct_order_items WHERE id = $1`, [it.itemId]);
          continue;
        }
        const itemUpdates: string[] = [];
        const itemParams: unknown[] = [];
        let iIdx = 1;
        if (it.resolved_price !== undefined) {
          itemUpdates.push(`resolved_price = $${iIdx++}`);
          itemParams.push(it.resolved_price);
        }
        if (it.resolved_product_id !== undefined) {
          itemUpdates.push(`resolved_product_id = $${iIdx++}`);
          itemParams.push(it.resolved_product_id);
        }
        if (itemUpdates.length) {
          itemUpdates.push(`resolved_at = NOW()`);
          itemUpdates.push(`resolved_by_admin_id = $${iIdx++}`);
          itemParams.push(admin.id);
          itemParams.push(it.itemId);
          await client.query(
            `UPDATE direct_order_items SET ${itemUpdates.join(', ')} WHERE id = $${iIdx}`,
            itemParams
          );
        }
      }
    }

    // Recompute total when line items changed.
    if (parsed.data.final_subtotal !== undefined || parsed.data.final_delivery_fee !== undefined) {
      const t = await client.query(
        `SELECT subtotal::float as s, delivery_fee::float as d, service_fee::float as sf, tax::float as tx
         FROM orders WHERE id = $1`,
        [orderId]
      );
      const r = t.rows[0];
      const total = +(Number(r.s) + Number(r.d) + Number(r.sf) + Number(r.tx)).toFixed(2);
      await client.query(`UPDATE orders SET total = $1 WHERE id = $2`, [total, orderId]);
    }

    // Log to order_status_logs when status flipped.
    if (parsed.data.status && parsed.data.status !== ord.rows[0].status) {
      await client.query(
        `INSERT INTO order_status_logs
          (order_id, old_status, new_status, changed_by_admin_id, notes)
         VALUES ($1, $2, $3, $4, $5)`,
        [orderId, ord.rows[0].status, parsed.data.status, admin.id, parsed.data.internal_notes || null]
      );
      // System message to chat.
      await client.query(
        `INSERT INTO direct_order_messages
          (order_id, sender_type, sender_admin_id, body, message_kind)
         VALUES ($1, 'system', $2, $3, 'system')`,
        [orderId, admin.id, `تحديث الحالة: ${ord.rows[0].status} → ${parsed.data.status}`]
      );

      // SECURITY (F4): when an admin flips an order to 'cancelled',
      // release the coupon slot back to the pool. Previously the
      // `coupons.used_count` was only ever incremented at checkout and
      // was never decremented on cancel/refund — every cancelled order
      // permanently consumed one use of the coupon, draining it for
      // legitimate future customers. The DB-level CHECK
      // (used_count >= 0, see migration 031) prevents this UPDATE from
      // going negative if a double-cancel races against a stale read.
      // We additionally gate on `used_count > 0` so a second cancel of
      // the same order is a no-op.
      if (parsed.data.status === "cancelled") {
        await client.query(
          `UPDATE coupons
             SET used_count = GREATEST(used_count - 1, 0)
           WHERE code = (SELECT coupon_code FROM orders WHERE id = $1)
             AND used_count > 0`,
          [orderId]
        );
      }
    }

    // Phase 1 / T4: when the assigned driver changed, record it on
    // order_status_logs (notes column) and post a system message on the
    // order chat so the customer + driver see the reassignment.
    if (driverChange && String(driverChange.oldDriver) !== String(driverChange.newDriver)) {
      await client.query(
        `INSERT INTO order_status_logs
          (order_id, old_status, new_status, changed_by_admin_id, notes)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          orderId,
          ord.rows[0].status,
          ord.rows[0].status,
          admin.id,
          driverChange.newDriver ? 'تعيين مندوب' : 'إلغاء تعيين مندوب',
        ]
      );
      await client.query(
        `INSERT INTO direct_order_messages
          (order_id, sender_type, sender_admin_id, body, message_kind)
         VALUES ($1, 'system', $2, $3, 'system')`,
        [
          orderId,
          admin.id,
          driverChange.newDriver ? 'تم تعيين مندوب للطلب' : 'تم إلغاء تعيين المندوب',
        ]
      );
    }

    await client.query('COMMIT');
    await logAdminAction(admin, 'update_direct_order', { entityId: orderId, details: parsed.data });
    return NextResponse.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    logError('admin update order failed', err);
    return NextResponse.json({ success: false, error: 'تعذر التحديث' }, { status: 500 });
  } finally {
    client.release();
  }
}