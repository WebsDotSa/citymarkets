import { NextRequest, NextResponse } from 'next/server';
import { pool, query } from '@/lib/db';
import { requireAdminApi } from "@/lib/identity/admin-api-auth-db";
import { logAdminAction } from '@/lib/admin-audit';
import { updateOrderSchema } from '@/lib/validation';
import { awardPointsForOrder, getLoyaltySettings, resolveRedeemForOrder } from '@/lib/orders/loyalty';

import { error as logError, warn as logWarn, info as logInfo } from '@/lib/logger';
import { ALL_ORDER_STATES, ALL_PAYMENT_STATES, assertValidTransition, invalidTransitionMessage } from '@/lib/orders/state-machine';
import {
  ORDER_BASE_COLUMNS,
  ORDER_LIST_COLUMNS,
  ORDER_ADDRESS_COLUMNS,
  ORDER_USER_COLUMNS,
  ORDER_DETAIL_JOINS,
  ORDER_LIST_JOINS,
} from '@/lib/orders/sql-fragments';

function idCheck(url: URL) {
  const id = url.searchParams.get('id');
  if (!id)
    return NextResponse.json({ success: false, error: 'المعرّف مطلوب' }, { status: 400 });
  return id;
}

export async function GET(request: NextRequest) {
  const gate = await requireAdminApi(request, 'manage_orders');
  if (gate instanceof NextResponse) return gate;
  try {
    const url = new URL(request.url);
    const singleId = url.searchParams.get('id');

    if (singleId) {
      const ord = await query(
        `SELECT ${ORDER_BASE_COLUMNS},
                o.address_id, o.user_id::text as user_id,
                ${ORDER_ADDRESS_COLUMNS},
                ${ORDER_USER_COLUMNS}
         ${ORDER_DETAIL_JOINS}
         WHERE o.id = $1
         LIMIT 1`,
        [singleId]
      );
      const ordRows = ord.rows;
      if (ordRows.length === 0) {
        return NextResponse.json({ success: false, error: 'الطلب غير موجود' }, { status: 404 });
      }
      const items = await query(
        `SELECT oi.id, oi.product_id, oi.qty as quantity, oi.unit_price as price,
                p.name_ar, p.image_url
         FROM order_items oi
         JOIN products_unified p ON oi.product_id = p.id
         WHERE oi.order_id = $1
         ORDER BY oi.id`,
        [singleId]
      );
      const itemsRows = items.rows;
      // Surface WHO last flipped the status (employee vs driver).
      // Joins admin_users so the UI can render a real name + role instead
      // of the raw "driver" string the legacy route used.
      const lastStatusChangeRes = await query(
        `SELECT l.old_status, l.new_status, l.created_at,
                l.changed_by_admin_id, l.changed_by as changed_by_legacy,
                au.name as changed_by_name, au.role as changed_by_role
           FROM order_status_logs l
           LEFT JOIN admin_users au ON au.id = l.changed_by_admin_id
          WHERE l.order_id = $1
          ORDER BY l.created_at DESC
          LIMIT 1`,
        [singleId]
      );
      const lastStatusChange = lastStatusChangeRes.rows[0] ?? null;
      return NextResponse.json({
        success: true,
        order: ordRows[0],
        items: itemsRows,
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
    }

    const { searchParams } = new URL(request.url);
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '20', 10)));
    const offset = (page - 1) * limit;
    const statusFilter = searchParams.get('status')?.trim() || '';
    const paymentStatusFilter = searchParams.get('payment_status')?.trim() || '';
    const search = searchParams.get('search')?.trim() || '';

    // Scheduled-delivery filters (Phase D, 2026-09-30):
    //   ?scheduled_date=YYYY-MM-DD → only orders whose scheduled_for
    //     falls on that Riyadh calendar day.
    //   ?slot_window=morning|noon|afternoon|evening → only orders
    //     whose slot_window matches (validated against the live config
    //     so a stale or typo'd value silently drops the filter rather
    //     than 500s).
    const scheduledDateRaw = searchParams.get('scheduled_date')?.trim() || '';
    const slotWindowRaw = searchParams.get('slot_window')?.trim() || '';
    // YYYY-MM-DD with a fixed length and digit shape — anything else
    // is silently ignored so a stale UI link doesn't crash the route.
    const scheduledDate =
      /^\d{4}-\d{2}-\d{2}$/.test(scheduledDateRaw) ? scheduledDateRaw : '';
    let slotWindow = '';
    if (slotWindowRaw) {
      try {
        const { parseSlotsConfig } = await import('@/lib/delivery/delivery-slots');
        const cfgRes = await query(
          `SELECT value FROM delivery_settings WHERE key = 'slots' LIMIT 1`,
        );
        const cfg = parseSlotsConfig(cfgRes.rows[0]?.value);
        slotWindow = cfg.windows.some((s) => s.id === slotWindowRaw)
          ? slotWindowRaw
          : '';
      } catch {
        slotWindow = '';
      }
    }

    // Validate statusFilter against known values — silently ignore invalid filters
    // instead of passing arbitrary strings to the SQL query. The canonical
    // list lives in `@/lib/orders/state-machine` so the API stays in sync
    // with the Postgres enum and the UI state machine.
    const safeStatusFilter = (ALL_ORDER_STATES as readonly string[]).includes(statusFilter)
      ? statusFilter
      : '';
    // payment_status enum is wider than the canonical `ALL_PAYMENT_STATES`
    // because the legacy `unpaid` alias still exists in some rows (pre-migration
    // state, kept for backwards compatibility in /api/payments/status). We
    // explicitly union the canonical four with the legacy alias.
    const allowedPaymentStatuses: readonly string[] = [
      ...ALL_PAYMENT_STATES,
      "unpaid",
    ];
    const safePaymentStatusFilter = allowedPaymentStatuses.includes(paymentStatusFilter)
      ? paymentStatusFilter
      : '';

    const conditions: string[] = [];
    const params: (string | number)[] = [];
    let pi = 1;
    if (safeStatusFilter) {
      conditions.push(`o.status = $${pi++}`);
      params.push(safeStatusFilter);
    }
    if (safePaymentStatusFilter) {
      conditions.push(`o.payment_status = $${pi++}`);
      params.push(safePaymentStatusFilter);
    }
    if (search) {
      conditions.push(
        `(o.guest_name ILIKE $${pi} OR o.guest_phone ILIKE $${pi} OR u.name ILIKE $${pi} OR u.phone ILIKE $${pi} OR o.id::text ILIKE $${pi})`
      );
      params.push(`%${search}%`);
      pi++;
    }
    if (scheduledDate) {
      // The customer supplies Riyadh wall-clock; the column is timestamptz
      // (UTC) so we map via `scheduled_for` directly. Using `DATE(...)` in
      // the server timezone is good enough — orders are inserted with the
      // resolved UTC instant, and the admin's UI strips the time component
      // before submitting the filter.
      conditions.push(`DATE(o.scheduled_for AT TIME ZONE 'Asia/Riyadh') = $${pi++}::date`);
      params.push(scheduledDate);
    }
    if (slotWindow) {
      conditions.push(`o.slot_window = $${pi++}`);
      params.push(slotWindow);
    }
    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countResult = await query(
      `SELECT COUNT(*) as total FROM orders o LEFT JOIN users u ON o.user_id = u.id ${whereClause}`,
      params
    );
    const total = parseInt(countResult.rows[0].total, 10);

    const dataParams = [...params, limit, offset];
    const result = await query(
      `SELECT ${ORDER_LIST_COLUMNS},
            a.label as address_label, a.address_text, a.lat as address_lat, a.lng as address_lng,
            ${ORDER_USER_COLUMNS}
     ${ORDER_LIST_JOINS}
     ${whereClause}
     ORDER BY o.created_at DESC
     LIMIT $${pi++} OFFSET $${pi++}`,
      dataParams
    );
    return NextResponse.json({
      success: true,
      data: result.rows,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    logError('Admin orders API error:', error);
    return NextResponse.json({ success: false, error: 'فشل جلب الطلبات' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  const gate = await requireAdminApi(request, 'manage_orders');
  if (gate instanceof NextResponse) return gate;
  try {
    const url = new URL(request.url);
    const idCheckResult = idCheck(url);
    if (typeof idCheckResult !== 'string') return idCheckResult;

    const rawBody = await request.json();
    const parsed = updateOrderSchema.safeParse(rawBody);
    if (!parsed.success) {
      const firstIssue = parsed.error.errors[0];
      return NextResponse.json(
        { success: false, error: firstIssue?.message || 'بيانات الطلب غير صالحة' },
        { status: 400 }
      );
    }
    const { status, internal_notes, driver_id } = parsed.data;

    const sets: string[] = [];
    const vals: unknown[] = [];
    let n = 1;

    if (status !== undefined && status !== null) {
      sets.push(`status = $${n++}`);
      vals.push(status);
    }

    if (internal_notes !== undefined) {
      sets.push(`internal_notes = $${n++}`);
      // null clears the notes; otherwise store as-is
      vals.push(internal_notes === null ? null : String(internal_notes));
    }

    // Phase 1 / T4: admin assigns / unassigns a delivery driver via the
    // PUT endpoint too. Resolve admin_users.id → drivers.id here; reject
    // 400 if the caller is inactive or has no drivers row, so the operator
    // gets a clear error rather than a silently unbound order.
    let resolvedDriverId: string | null | undefined = undefined;
    if (driver_id !== undefined) {
      if (driver_id === null) {
        resolvedDriverId = null;
      } else {
        const dRes = await query(
          `SELECT d.id FROM drivers d
             JOIN admin_users au ON au.id = d.admin_user_id
            WHERE au.id = $1 AND au.is_active = true`,
          [driver_id]
        );
        if (dRes.rows.length === 0) {
          return NextResponse.json(
            { success: false, error: 'المندوب غير موجود أو غير نشط' },
            { status: 400 }
          );
        }
        resolvedDriverId = dRes.rows[0].id;
      }
      sets.push(`driver_id = $${n++}`);
      vals.push(resolvedDriverId);
    }

    if (sets.length === 0) {
      return NextResponse.json({ success: false, error: 'لا توجد حقول للتحديث' }, { status: 400 });
    }

    sets.push('updated_at = NOW()');
    vals.push(idCheckResult);

    // Capture the OLD status before we mutate so we can record an accurate
    // transition row in order_status_logs. We need it for two reasons:
    //   * The log row needs (old_status, new_status, changed_by_admin_id)
    //   * If the admin flips status to the same value (no-op), we still
    //     want to know "they tried" — but a log row with old == new is
    //     noise. Skip the insert in that case.
    //
    // Phase 1 / T4: also capture the old driver_id so we can write an
    // audit row + system message when the assignment changed.
    //
    // P2-5 (PCP-76.F6): add FOR UPDATE so a concurrent admin cannot flip
    // status between this SELECT and the assertValidTransition guard. Without
    // the lock the state-machine check is advisory only.
    const oldStatusRes = await query(
      `SELECT status, driver_id FROM orders WHERE id = $1 LIMIT 1 FOR UPDATE`,
      [idCheckResult]
    );
    const oldStatus = oldStatusRes.rows[0]?.status ?? null;
    const oldDriverId = oldStatusRes.rows[0]?.driver_id ?? null;

    // Centralized state-machine guard. Admins get the documented escape
    // hatch (delivered → cancelled); everything else follows the role
    // table in `@/lib/orders/state-machine`.
    if (status !== undefined && status !== null && oldStatus) {
      try {
        assertValidTransition('admin', 'orders', String(oldStatus), String(status));
      } catch (err) {
        const message = invalidTransitionMessage(
          'admin',
          'orders',
          String(oldStatus),
          String(status),
        );
        logWarn('[admin/orders PUT] rejected invalid transition', {
          orderId: idCheckResult,
          from: oldStatus,
          to: status,
          reason: err instanceof Error ? err.message : String(err),
        });
        return NextResponse.json(
          { success: false, error: message },
          { status: 400 },
        );
      }
    }

    await query(
      `UPDATE orders SET ${sets.join(', ')} WHERE id = $${n}`,
      vals
    );

    // Record the status transition. Best-effort: a failure here must NOT
    // roll back the status change the admin just made. The admin's intent
    // is the primary side-effect; the audit row is secondary.
    if (
      status !== undefined &&
      status !== null &&
      oldStatus !== null &&
      oldStatus !== status
    ) {
      try {
        await query(
          `INSERT INTO order_status_logs
             (order_id, old_status, new_status, changed_by_admin_id, changed_by, notes)
           VALUES ($1, $2, $3, $4, $5, NULL)`,
          [
            idCheckResult,
            oldStatus,
            status,
            gate.admin.id,
            `admin:${gate.admin.role}`,
          ]
        );
      } catch (logErr) {
        logWarn('[order_status_log] admin status log insert failed', {
          orderId: idCheckResult,
          error: logErr instanceof Error ? logErr.message : String(logErr),
        });
      }
    }

    await logAdminAction(gate.admin, 'order.update', {
      entityType: 'order',
      entityId: idCheckResult,
      details: {
        status,
        internal_notes: internal_notes !== undefined ? '[updated]' : undefined,
        driver_id: driver_id !== undefined ? '[updated]' : undefined,
      },
      request,
    });

    // Phase 1 / T4: when the assigned driver changed via the PUT endpoint,
    // record it on order_status_logs and post a system chat message. Best-
    // effort (mirror the status-log block above) so a missing log table
    // never rolls back the assignment itself.
    if (
      driver_id !== undefined &&
      String(oldDriverId) !== String(resolvedDriverId)
    ) {
      try {
        await query(
          `INSERT INTO order_status_logs
             (order_id, old_status, new_status, changed_by_admin_id, changed_by, notes)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            idCheckResult,
            oldStatus ?? null,
            oldStatus ?? null,
            gate.admin.id,
            `admin:${gate.admin.role}`,
            resolvedDriverId ? 'تعيين مندوب' : 'إلغاء تعيين مندوب',
          ]
        );
        await query(
          `INSERT INTO direct_order_messages
             (order_id, sender_type, sender_admin_id, body, message_kind)
           VALUES ($1, 'system', $2, $3, 'system')`,
          [
            idCheckResult,
            gate.admin.id,
            resolvedDriverId ? 'تم تعيين مندوب للطلب' : 'تم إلغاء تعيين المندوب',
          ]
        );
      } catch (logErr) {
        logWarn('[order_status_log] admin driver change log insert failed', {
          orderId: idCheckResult,
          error: logErr instanceof Error ? logErr.message : String(logErr),
        });
      }
    }

    // COD/wallet orders don't go through a payment webhook, so the loyalty
    // earn path that fires on payment success never runs. Credit points here
    // when an admin transitions the order to 'delivered' — same logic the
    // webhook uses, gated by payment_method and idempotent via
    // UNIQUE(ref_order_id, type). Best-effort: if the loyalty call fails
    // we log and continue, since the status change is the product feature
    // and the operator can retry (idempotency guarantees no double credit).
    if (
      status === 'delivered' &&
      (status !== undefined && status !== null)
    ) {
      try {
        await maybeCreditLoyaltyOnDelivery(idCheckResult);
      } catch (loyaltyErr) {
        logError('[loyalty] COD/wallet delivery grant failed', loyaltyErr, {
          orderId: idCheckResult,
        });
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ success: false, error: 'فشل تحديث الطلب' }, { status: 500 });
  }
}

/**
 * On admin transition to 'delivered', credit loyalty for cash/wallet
 * orders. Mirrors what the payment webhooks do, so customers who pay on
 * delivery earn the same points as customers who paid online.
 *
 * Idempotent: awardPointsForOrder/resolveRedeemForOrder rely on the
 * UNIQUE(ref_order_id, type) index (migration 046). Calling this twice
 * (e.g. admin flips delivered → back → delivered again) is a no-op.
 *
 * Runs in its own connection because the PUT handler above does not
 * hold a transaction; the status UPDATE has already committed. If the
 * loyalty grant itself fails, the status change still stands and the
 * admin can retry the transition to retrigger this code.
 */
async function maybeCreditLoyaltyOnDelivery(orderId: string): Promise<void> {
  const client = await pool.connect();
  try {
    // SELECT ... FOR UPDATE locks the row so two concurrent admins
    // can't both pass the "already credited?" guard.
    const ordRes = await client.query(
      `SELECT user_id::text as user_id,
              catalog_subtotal::float as catalog_subtotal,
              points_redeemed::float as points_redeemed,
              LOWER(COALESCE(payment_method, '')) as payment_method
         FROM orders
        WHERE id = $1
        FOR UPDATE`,
      [orderId],
    );
    const row = ordRes.rows[0];
    if (!row || !row.user_id) return; // guest orders never earn
    if (row.payment_method !== 'cash' && row.payment_method !== 'wallet' && row.payment_method !== 'cod') {
      return;
    }

    const settings = await getLoyaltySettings();

    if (Number(row.points_redeemed) > 0) {
      await resolveRedeemForOrder(client, {
        orderId,
        userId: row.user_id,
        pointsRedeemed: Number(row.points_redeemed),
      });
    }
    if (Number(row.catalog_subtotal) > 0) {
      await awardPointsForOrder(client, {
        orderId,
        userId: row.user_id,
        catalogSubtotal: Number(row.catalog_subtotal),
        settings,
      });
    }
  } finally {
    client.release();
  }
}
