import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { requireAdminApi } from "@/lib/admin-api-auth";

import { error as logError, warn as logWarn, info as logInfo } from '@/lib/logger';

export const dynamic = "force-dynamic";

// GET /api/admin/driver/orders/[id] - Get single order details
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireAdminApi(request, "view_delivery_orders");
  if (gate instanceof NextResponse) return gate;

  const { id } = await params;

  try {
    const result = await pool.query(
      `SELECT
        o.id,
        o.tracking_code as order_number,
        o.status,
        o.total::float as total,
        o.delivery_fee::float as delivery_fee,
        o.payment_method,
        o.payment_status,
        o.created_at,
        o.updated_at,
        o.notes as order_notes,
        u.id as user_id,
        u.name as customer_name,
        u.phone as customer_phone,
        da.address_text,
        da.lat as delivery_lat,
        da.lng as delivery_lng,
        da.label as address_label,
        (
          SELECT json_agg(json_build_object(
            'id', oi.id,
            'product_id', oi.product_id,
            'name', p.name_ar,
            'quantity', oi.qty,
            'price', oi.unit_price::float,
            'image_url', p.image_url
          ))
          FROM order_items oi
          JOIN products_unified p ON oi.product_id = p.id
          WHERE oi.order_id = o.id
        ) as items,
        (
          SELECT COUNT(*)::int
          FROM orders
          WHERE user_id = o.user_id AND status = 'delivered'
        ) as customer_order_count
      FROM orders o
      LEFT JOIN users u ON o.user_id = u.id
      LEFT JOIN addresses da ON o.address_id = da.id
      WHERE o.id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return NextResponse.json(
        { success: false, error: "الطلب غير موجود" },
        { status: 404 }
      );
    }

    const order = result.rows[0];

    // Surface WHO last flipped the status so the driver-side detail page
    // can render "تم التسليم بواسطة: فلان" without an extra round-trip.
    const lastStatusChangeRes = await pool.query(
      `SELECT l.old_status, l.new_status, l.created_at,
              l.changed_by_admin_id, l.changed_by as changed_by_legacy,
              au.name as changed_by_name, au.role as changed_by_role
         FROM order_status_logs l
         LEFT JOIN admin_users au ON au.id = l.changed_by_admin_id
        WHERE l.order_id = $1
        ORDER BY l.created_at DESC
        LIMIT 1`,
      [id]
    );
    const lastStatusChange = lastStatusChangeRes.rows[0] ?? null;

    return NextResponse.json({
      success: true,
      order,
      last_status_change: lastStatusChange
        ? {
            old_status: lastStatusChange.old_status,
            new_status: lastStatusChange.new_status,
            created_at: lastStatusChange.created_at,
            changed_by_admin_id: lastStatusChange.changed_by_admin_id,
            changed_by_name: lastStatusChange.changed_by_name ?? null,
            changed_by_role: lastStatusChange.changed_by_role ?? null,
            changed_by_legacy: lastStatusChange.changed_by_legacy ?? null,
          }
        : null,
    });
  } catch (error) {
    logError("Driver order detail error:", error);
    return NextResponse.json(
      { success: false, error: "حدث خطأ في جلب تفاصيل الطلب" },
      { status: 500 }
    );
  }
}

// PATCH /api/admin/driver/orders/[id] - Update order status
//
// Phase 1 / Task T3: Drivers now atomically claim orders by setting
// driver_id on the pending → on_the_way transition. The PATCH body
// accepts an optional `claim: true` flag; when set, the UPDATE matches
// `(driver_id IS NULL OR driver_id = $driverId)` so a driver can claim
// an unassigned order or update their own claim, but cannot steal
// another driver's order. Without the flag, the UPDATE matches only
// `driver_id = $driverId` so drivers can only mutate their own orders.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireAdminApi(request, "update_delivery_status");
  if (gate instanceof NextResponse) return gate;

  const { id } = await params;
  const body = await request.json();
  const { status, failureReason, claim } = body as {
    status?: string;
    failureReason?: string;
    claim?: boolean;
  };

  // Valid status transitions for driver. The order_status_enum has:
  //   pending, confirmed, shopping, on_the_way, delivered, cancelled, paid.
  // Drivers act on the delivery leg: pick up (`on_the_way`), complete
  // (`delivered`), or mark cancelled with a reason.
  const validStatuses = ["on_the_way", "delivered", "cancelled"];

  if (!status || !validStatuses.includes(status)) {
    return NextResponse.json(
      {
        success: false,
        error: "حالة غير صالحة. القيم المسموحة: on_the_way, delivered, cancelled",
      },
      { status: 400 }
    );
  }

  // If cancelled (failed delivery), require a reason
  if (status === "cancelled" && !failureReason) {
    return NextResponse.json(
      { success: false, error: "يجب تحديد سبب إلغاء التوصيل" },
      { status: 400 }
    );
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Resolve the caller's drivers.id from their admin_users.id. Should
    // always exist post-T1 migration; defensive 403 if not.
    const driverLookup = await client.query(
      `SELECT id FROM drivers WHERE admin_user_id = $1`,
      [gate.admin.id]
    );
    if (driverLookup.rows.length === 0) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        {
          success: false,
          error: "حساب السائق غير مهيأ، تواصل مع الإدارة",
        },
        { status: 403 }
      );
    }
    const driverId = driverLookup.rows[0].id as string;

    // Lock the order row so two drivers tapping "claim" at the same
    // instant serialize on the row lock — one wins, the other gets 409.
    const orderCheck = await client.query(
      `SELECT id, status, payment_status, driver_id FROM orders WHERE id = $1 FOR UPDATE`,
      [id]
    );

    if (orderCheck.rows.length === 0) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { success: false, error: "الطلب غير موجود" },
        { status: 404 }
      );
    }

    const currentStatus = orderCheck.rows[0].status;
    const currentDriverId = orderCheck.rows[0].driver_id as string | null;
    const validCurrentStatuses = ["pending", "on_the_way"];

    if (!validCurrentStatuses.includes(currentStatus)) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        {
          success: false,
          error: `لا يمكن تحديث الطلب من الحالة الحالية "${currentStatus}"`,
        },
        { status: 400 }
      );
    }

    // Decide the driver_id to write based on claim intent:
    //   claim=true  → write this driver's id (sets it if NULL or matches)
    //   claim=false → only update if the order is already theirs
    const updates: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (claim) {
      // Atomic claim: sets driver_id if NULL or already ours; refuses to
      // overwrite another driver's claim. If rowCount = 0, someone else
      // claimed it first → 409.
      updates.push(`status = $${paramIndex++}`);
      values.push(status);
      updates.push(`driver_id = $${paramIndex++}`);
      values.push(driverId);
      updates.push(`updated_at = NOW()`);

      if (status === "delivered" && orderCheck.rows[0].payment_status !== "paid") {
        updates.push(`payment_status = 'paid'`);
      }

      values.push(id);
      const claimWhere = `id = $${paramIndex} AND (driver_id IS NULL OR driver_id = $${paramIndex + 1})`;
      paramIndex += 2;
      values.push(driverId);

      const claimRes = await client.query(
        `UPDATE orders SET ${updates.join(", ")}
          WHERE ${claimWhere}
          RETURNING id, tracking_code as order_number, status`,
        values
      );

      if (claimRes.rowCount === 0) {
        await client.query("ROLLBACK");
        return NextResponse.json(
          {
            success: false,
            error: "تم استلام الطلب من مندوب آخر",
            already_claimed_by: currentDriverId,
          },
          { status: 409 }
        );
      }

      await client.query("COMMIT");
      // Audit log + coupon release run outside the txn so a missing log
      // table never blocks the actual status update.
      await client.query(
        `INSERT INTO order_status_logs
           (order_id, old_status, new_status, changed_by_admin_id, changed_by, notes)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT DO NOTHING`,
        [id, currentStatus, status, gate.admin.id, "driver", failureReason || null]
      ).catch(() => {});

      if (status === "cancelled") {
        await client.query(
          `UPDATE coupons
             SET used_count = GREATEST(used_count - 1, 0)
           WHERE code = (SELECT coupon_code FROM orders WHERE id = $1)
             AND used_count > 0`,
          [id]
        ).catch(() => {});
      }

      return NextResponse.json({
        success: true,
        order: claimRes.rows[0],
        message: status === "delivered"
          ? "تم تأكيد التوصيل بنجاح"
          : status === "cancelled"
          ? "تم تسجيل إلغاء التوصيل"
          : "تم بدء التوصيل",
      });
    }

    // Non-claim path: driver updates their own order (e.g. on_the_way →
    // delivered, or on_the_way → cancelled). Must be the assigned driver.
    if (currentDriverId !== driverId) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        {
          success: false,
          error: "هذا الطلب غير مخصص لك. اضغط 'ابدأ التوصيل' لتأكيد الاستلام أولاً",
        },
        { status: 403 }
      );
    }

    updates.push(`status = $${paramIndex++}`);
    values.push(status);
    updates.push(`updated_at = NOW()`);
    if (status === "delivered" && orderCheck.rows[0].payment_status !== "paid") {
      updates.push(`payment_status = 'paid'`);
    }
    values.push(id);

    const result = await client.query(
      `UPDATE orders SET ${updates.join(", ")}
        WHERE id = $${paramIndex}
        RETURNING id, tracking_code as order_number, status`,
      values
    );

    await client.query("COMMIT");

    // Audit log + coupon release outside the txn.
    await client.query(
      `INSERT INTO order_status_logs
         (order_id, old_status, new_status, changed_by_admin_id, changed_by, notes)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT DO NOTHING`,
      [id, currentStatus, status, gate.admin.id, "driver", failureReason || null]
    ).catch(() => {});

    if (status === "cancelled") {
      await client.query(
        `UPDATE coupons
           SET used_count = GREATEST(used_count - 1, 0)
         WHERE code = (SELECT coupon_code FROM orders WHERE id = $1)
           AND used_count > 0`,
        [id]
      ).catch(() => {});
    }

    return NextResponse.json({
      success: true,
      order: result.rows[0],
      message: status === "delivered"
        ? "تم تأكيد التوصيل بنجاح"
        : status === "cancelled"
        ? "تم تسجيل إلغاء التوصيل"
        : "تم تحديث حالة الطلب",
    });
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch { /* no-op */ }
    logError("Driver update status error:", error);
    return NextResponse.json(
      { success: false, error: "حدث خطأ في تحديث حالة الطلب" },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}
