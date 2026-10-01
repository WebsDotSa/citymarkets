import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { requireAdminApi } from "@/lib/identity/admin-api-auth-db";
import { error as logError } from '@/lib/logger';
import { validateUuidOrError } from "@/lib/api/uuid-guard";
import {
  recordPaymentEvent,
  finalizePaymentEvent,
} from '@/lib/payments/event-ledger';
import {
  canTransition as stateMachineCanTransition,
  invalidTransitionMessage as stateMachineInvalidMessage,
  PARENT_ORDER_TRANSITIONS_BY_ROLE,
} from '@/lib/orders/state-machine';
import {
  awardPointsForOrder,
  getLoyaltySettings,
  releaseRedeemHoldForOrderSafe,
} from '@/lib/orders/loyalty';

export const dynamic = "force-dynamic";

// GET /api/admin/driver/orders/[id] - Get single order details
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireAdminApi(request, "view_delivery_orders");
  if (gate instanceof NextResponse) return gate;

  const { id } = await params;
  const badId = validateUuidOrError(id, "معرّف الطلب");
  if (badId) return badId;

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
  const badId = validateUuidOrError(id, "معرّف الطلب");
  if (badId) return badId;
  const client = await pool.connect();
  try {
    // P2-2 (PCP-76.F3): parse JSON inside the try block so a malformed
    // body surfaces as our 400 JSON response instead of bubbling up as
    // Next.js's default 500 (no {success,error} envelope, no leak).
    let body: { status?: string; failureReason?: string; claim?: boolean };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      await client.query("ROLLBACK").catch(() => {});
      return NextResponse.json(
        { success: false, error: "بيانات غير صالحة" },
        { status: 400 },
      );
    }
    const { status, failureReason, claim } = body;

  // P2-1 (production hardening 2): the driver-role transition table
  // now lives in `@/lib/orders/state-machine`. The set of legal `to`
  // states is implicit in `stateMachineCanTransition('driver', 'orders',
  // _, status)` returning true for any valid `from`. We list the legal
  // target states here for the early-return 400 — the state machine
  // also enforces it once the order's current status is loaded.
  // Derived from the state machine (audit C14) so any future new legal
  // target state added to the driver table flows through automatically.
  const validStatuses: readonly string[] = [
    ...new Set(
      Object.values(PARENT_ORDER_TRANSITIONS_BY_ROLE.driver).flatMap(
        (targets) => [...targets],
      ),
    ),
  ];

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
    // We also pull `user_id` + `catalog_subtotal` so the post-COMMIT
    // COD loyalty credit (P0-2 fix) has the inputs it needs without a
    // second round-trip. NULL `catalog_subtotal` for pre-038 rows is
    // coerced to 0 inside `awardPointsForOrder` via
    // `computeEarnPoints` (which guards `points <= 0`).
    const orderCheck = await client.query(
      `SELECT id, status, payment_status, driver_id,
              user_id, catalog_subtotal::float as catalog_subtotal
         FROM orders WHERE id = $1 FOR UPDATE`,
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

    // P2-1: defer to the central state machine for transition
    // validation. The previous inline `validCurrentStatuses` check is
    // subsumed by `canTransition` — if the driver role can't transition
    // from `currentStatus` to `status`, we 400 with the Arabic message
    // generated from the same source.
    if (!stateMachineCanTransition("driver", "orders", currentStatus, status)) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        {
          success: false,
          error: stateMachineInvalidMessage("driver", "orders", currentStatus, status),
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

    // FIX (P1-1): when COD is collected on delivery, route the
    // payment_status='paid' write through the payment_events ledger
    // instead of mutating orders.payment_status directly. Previously
    // a driver flipping status='delivered' bypassed the ledger — no
    // audit row, no idempotency, and a network retry could either
    // double-write (harmless) or be swallowed by a gateway-style
    // collision that the ledger is designed to prevent.
    //
    // The `markingCodPaid` flag is consumed by both the claim and
    // non-claim branches below; it gates whether to add
    // `payment_status = 'paid'` to the UPDATE. The ledger INSERT
    // happens BEFORE the UPDATE inside the same transaction so a
    // duplicate INSERT short-circuits with rowCount=0 (via 23505) and
    // the order update is skipped — leaving the prior successful
    // COD row intact.
    let markingCodPaid = false;
    let codLedgerResult: "inserted" | "duplicate" | null = null;
    if (status === "delivered" && orderCheck.rows[0].payment_status !== "paid") {
      markingCodPaid = true;
      codLedgerResult = await recordPaymentEvent(client, {
        // For COD the invoice is the order itself — there is no
        // gateway-issued invoice id to correlate against.
        invoiceId: id,
        gateway: "cod",
        eventType: "cod.collected",
        raw: {
          order_id: id,
          driver_admin_id: gate.admin.id,
          driver_id: driverId,
          collected_at: new Date().toISOString(),
        },
      });
    }

    if (claim) {
      // Atomic claim: sets driver_id if NULL or already ours; refuses to
      // overwrite another driver's claim. If rowCount = 0, someone else
      // claimed it first → 409.
      updates.push(`status = $${paramIndex++}`);
      values.push(status);
      updates.push(`driver_id = $${paramIndex++}`);
      values.push(driverId);
      updates.push(`updated_at = NOW()`);

      if (markingCodPaid && codLedgerResult === "inserted") {
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

      // FIX (P1-1): finalize the cod.collected ledger row after COMMIT
      // so a subsequent replay of the same driver PATCH sees the row
      // at status='processed' rather than 'received'. Mirrors the
      // Moyasar / Tamara webhook finalize-after-COMMIT pattern.
      if (markingCodPaid && codLedgerResult === "inserted") {
        await client.query("COMMIT");
        await finalizePaymentEvent(client, {
          invoiceId: id,
          gateway: "cod",
          eventType: "cod.collected",
          status: "processed",
          orderId: id,
        });
      } else {
        await client.query("COMMIT");
      }
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
        // P1-7 (full-system audit 2026-09-30): release the loyalty
        // `pending_redeem` hold for this cancelled order. Best-effort:
        // failure is logged but does not block the response (same
        // `.catch(() => {})` posture as the coupon release above).
        releaseRedeemHoldForOrderSafe(pool, { orderId: id }).catch((err: unknown) => {
          logError("[driver cancel] loyalty hold release failed", err, { orderId: id });
        });
      }

      // P0-2 (full-system audit 2026-09-30): COD orders previously
      // skipped loyalty credit because only the Moyasar/Tamara
      // webhooks called `awardPointsForOrder`. Drivers mark COD paid
      // on delivery, so we credit here, post-COMMIT, mirroring the
      // webhook's award-on-paid semantics. Skipped for guest orders
      // (`user_id IS NULL`) and for orders with zero catalog subtotal.
      if (markingCodPaid && codLedgerResult === "inserted") {
        const codUserId = orderCheck.rows[0].user_id as string | null;
        const codCatalogSubtotal = Number(
          orderCheck.rows[0].catalog_subtotal ?? 0,
        );
        if (codUserId && codCatalogSubtotal > 0) {
          try {
            const settings = await getLoyaltySettings();
            await awardPointsForOrder(client, {
              orderId: id,
              userId: codUserId,
              catalogSubtotal: codCatalogSubtotal,
              settings,
            });
          } catch (loyaltyErr) {
            logError("[driver COD loyalty] award failed", loyaltyErr, {
              orderId: id,
              userId: codUserId,
            });
          }
        }
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
    // FIX (P1-1): only add `payment_status = 'paid'` if the ledger
    // INSERT above succeeded. If `codLedgerResult === 'duplicate'`,
    // a previous COD collection was already recorded for this order;
    // we leave the existing payment_status='paid' row alone and skip
    // a second mutation. markingCodPaid / codLedgerResult were set
    // earlier in this handler (before the claim branch).
    if (markingCodPaid && codLedgerResult === "inserted") {
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

    // FIX (P1-1): finalize the cod.collected ledger row so a replay
    // of the same driver PATCH sees status='processed' instead of
    // 'received'. Mirrors the Moyasar / Tamara webhook pattern.
    if (markingCodPaid && codLedgerResult === "inserted") {
      try {
        await finalizePaymentEvent(client, {
          invoiceId: id,
          gateway: "cod",
          eventType: "cod.collected",
          status: "processed",
          orderId: id,
        });
      } catch (finalErr) {
        logError("[event-ledger] cod finalize failed", finalErr, { orderId: id });
      }
    }

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
      // P1-7 (full-system audit 2026-09-30): release the loyalty
      // `pending_redeem` hold for this cancelled order. Same
      // best-effort posture as the claim branch above.
      releaseRedeemHoldForOrderSafe(pool, { orderId: id }).catch((err: unknown) => {
        logError("[driver cancel] loyalty hold release failed", err, { orderId: id });
      });
    }

    // P0-2 (full-system audit 2026-09-30): mirror the COD loyalty
    // award that runs on the claim branch — the non-claim branch
    // handles `on_the_way → delivered` for an order already claimed
    // by this driver, and must credit points just the same.
    if (markingCodPaid && codLedgerResult === "inserted") {
      const codUserId = orderCheck.rows[0].user_id as string | null;
      const codCatalogSubtotal = Number(
        orderCheck.rows[0].catalog_subtotal ?? 0,
      );
      if (codUserId && codCatalogSubtotal > 0) {
        try {
          const settings = await getLoyaltySettings();
          await awardPointsForOrder(client, {
            orderId: id,
            userId: codUserId,
            catalogSubtotal: codCatalogSubtotal,
            settings,
          });
        } catch (loyaltyErr) {
          logError("[driver COD loyalty] award failed", loyaltyErr, {
            orderId: id,
            userId: codUserId,
          });
        }
      }
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
